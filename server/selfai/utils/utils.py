import os
import sys
import yaml
import json
import shutil
from pptree import *
import copy
from collections import OrderedDict
from utils.client import Agent, create_logger, print_log
import traceback
import difflib
import pandas as pd
from typing import List, Dict

def load_json(json_file):
    with open(json_file, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_yaml(response_tasks, fmt="yaml", logger=None):
    yaml_content = {}
    error = None
    if fmt in response_tasks:
        try:
            yaml_start = response_tasks.index(fmt) + len(f"{fmt}\n")
            yaml_end = response_tasks.index("```", yaml_start)
            yaml_content = response_tasks[yaml_start:yaml_end].strip()
        except Exception as e:
            error = e
            logger.error(response_tasks)

    elif "yml" in response_tasks:
        try:
            yaml_start = response_tasks.index("yml") + len("yml\n")
            yaml_end = response_tasks.index("```", yaml_start)
            yaml_content = response_tasks[yaml_start:yaml_end].strip()
        except Exception as e:
            logger.error(response_tasks)
    try:
        if yaml_content:
            data = yaml.safe_load(yaml_content)
            return data, error
        else:
            return None, error
    except Exception as e:
        print(e)
        return None


def get_keys(d: Dict, parent_key: str = "", ignore_keys: List[str] = ["search_space"]):
    """
    get all keys of nested-dict
    Example:
        d = {"a": {"b": {"c": 1}}}
        get_keys(d)
        output: ['a.b.c', 'a.b', 'a']
    """
    keys = []
    for k, v in d.items():
        if k in ignore_keys:
            continue
        # construct full key name
        full_key = f"{parent_key}.{k}" if parent_key else k
        keys.append(full_key)
        # if value is dict, then recursively get its keys
        if isinstance(v, dict):
            keys.extend(get_keys(v, full_key, ignore_keys))
    return keys


def filter_keys(keys: List[str], substring: str) -> str:
    """
    filter keys based on substring
    """
    keys = [key for key in keys if substring in key]
    keys = filter(lambda x: x.split(".")[-1] == substring, keys)
    keys = list(keys)
    if len(keys) == 0:
        # deal with no exists key, add prefix "+" based on hydra config
        return "+" + substring
    elif len(keys) > 1:
        raise ValueError(f"Multiple keys {keys} found for {substring}")
    return keys[0]


def get_nested_attr(cfg: "Config", attr_path: str):  # type: ignore
    # split attr_path by dot
    attrs = attr_path.split(".")
    if isinstance(cfg, dict):
        for attr in attrs:
            cfg = cfg[attr]
    else:
        # access attributes layer by layer
        for attr in attrs:
            cfg = getattr(cfg, attr)  # access attributes layer by layer
    return cfg


def yaml2dict(response_tasks, search_space, fmt="yaml", logger=None):
    if isinstance(response_tasks, str):
        tmp = parse_yaml(response_tasks, fmt, logger=logger)
    else:
        tmp = response_tasks
    trial_hyper_params = []
    number = []
    try:
        if isinstance(tmp, list):
            tmp = {"trial": tmp}
            # trial_hyper_params = tmp["trials"][0]["tasks"][0]["hyper_parameters"]
            # {'lr': [0.001, 0.0005], 'k2': [0.0005, 0.01]}
        if isinstance(tmp, dict) and "params" not in tmp.keys():
            # maybe
            tmp = list(tmp.values())[0]
            # if isinstance(tmp, dict):
            #     for k, v in trial_hyper_params.items():
            #         if k not in search_space.keys():
            #             trial_hyper_params.pop(k)
            if isinstance(tmp, list):

                for i, trial in enumerate(tmp):
                    if isinstance(trial, dict):
                        all_keys = get_keys(trial)
                        trial_hyper_params.append({})
                        for k in search_space:
                            trial_hyper_params[i][k] = get_nested_attr(
                                trial, filter_keys(all_keys, k)
                            )
                        if "number" in trial.keys():
                            number.append(trial["number"])
                    else:
                        raise Exception()
            elif isinstance(tmp, dict):
                # {'trial_16': {'lr': 0.0001, 'k2': 0.0005}, 'trial_17': {'lr': 0.0001, 'k2': 0.001}, 'trial_18': {'lr': 0.0001, 'k2': 0.0005}}
                all_keys = get_keys(tmp)
                for k, v in tmp.items():
                    trial_hyper_params.append(v)
            else:
                trial_hyper_params = tmp
        else:
            trial_hyper_params = tmp

    except Exception as e:
        trial_hyper_params = []
        print("yaml2dict: ", e)

    return trial_hyper_params, number  # [{}, {}， {}]


def parse_json(args):
    print(args.gt_json_path)
    gt_data = load_json(f"{args.gt_json_path}")[1]  # system, user
    output = load_json(f"{args.train_json_path}")  # system, user
    params = [trial["params"] for trial in gt_data["content"]["trials"]]
    # params = [
    #     {k: round(value, 4)
    #     for k, value in param.items()}
    #     for param in params
    # ]
    if args.search_type != "grid":
        output[1]["content"]["search_trials"] = [
            {"number": idx, "params": trial["params"]}
            for idx, trial in enumerate(gt_data["content"]["trials"])
        ]
    # if search_space is None:
    # search_space = list(copy.deepcopy(params)[0].keys())
    # raise ValueError(f"parse_json: search_space {search_space} is wrong")
    # search_space = params

    # if isinstance(search_space, dict):
    #     search_space = list(search_space.keys())
    # elif isinstance(search_space, list):
    #     if len(search_space) > 1 and isinstance(search_space[0], str):
    #         pass
    #     else:
    #         raise ValueError(f"search_space: {search_space}")

    results = {}
    for idx, trial in enumerate(params):
        key = ""
        for k, v in OrderedDict(trial).items():
            if k not in args.ignore_key:
                key += f"_{k}:{v}"
        results[key[1:]] = gt_data["content"]["trials"][idx][args.metric]
    trial_param_name = list(trial.keys())

    merged_gt_results = copy.deepcopy(results)

    # results = None
    # completed_trials_dicts = []
    # for trial in output_data["content"]["trials"]:
    #     key = ""
    #     if "params" in trial.keys():
    #         trial = trial['params']
    #     for k, v in OrderedDict(trial).items():
    #         if k not in [args.metric]:
    #             key += f"_{k}:{v}"
    #     completed_trials_dicts.append(key[1:])

    completed_trials_dicts = output[1]["content"]["trials"]

    return (
        output,
        completed_trials_dicts,
        trial_param_name,
        merged_gt_results,
        gt_data["content"]["trials"],
    )


def filtered_trials(
    trial_hyper_params,
    gt_trials,
    merged_gt_results,
    completed_trials_dicts,
    trial_param_name,
    metric,
    logger=None,
):
    merged_gt_results = {key.lower(): value for key, value in merged_gt_results.items()}
    keys = list(merged_gt_results.keys())
    error_trials = []
    repeated_trials = []
    historical_trials = pd.DataFrame(
        pd.NA,
        index=range(len(completed_trials_dicts) + len(trial_hyper_params)),
        columns=["number", "trial_name"],
    )
    _filtered_trials = []
    new_number = []
    flag = False

    for i, param in enumerate(completed_trials_dicts):
        row = {}
        name = ""
        for k in trial_param_name:
            if "params" in param.keys():
                name = name + f"{k}:{param['params'][k]}_"
            else:
                name = name + f"{k}:{param[k]}_"
        row["number"] = param["number"]
        row["trial_name"] = name[:-1].lower()
        historical_trials.loc[i, row.keys()] = row

    for j, param in enumerate(trial_hyper_params):
        name = ""
        try:
            for k in trial_param_name:
                if "params" in param.keys():
                    name = name + f"{k}:{param['params'][k]}_"
                else:
                    name = name + f"{k}:{param[k]}_"
        except Exception as e:
            flag = True
            print("error: ", e)
            break
        name = name.lower()
        if not (historical_trials["trial_name"][: i + j + 1].isin([name[:-1]]).any()):
            try:
                #
                matches = difflib.get_close_matches(name[:-1], keys, n=1, cutoff=0.8)
                logger.info(
                    f"- [difflib] amnbious matches: {matches}, raw output: {name}"
                )
                if matches:
                    number = merged_gt_results[matches[0]]["number"]
                    param[metric] = merged_gt_results[matches[0]][metric]
                    name = matches[0] + "_"
                else:
                    number = merged_gt_results[name[:-1]]["number"]
                    param[metric] = merged_gt_results[name[:-1]][metric]
                param["number"] = number
                if not (
                    historical_trials["trial_name"][: i + j + 1].isin([name[:-1]]).any()
                ):
                    new_number.append(keys.index(name[:-1]))
                    _filtered_trials.append(param)
                    row = {"number": number, "trial_name": name[:-1]}
                    historical_trials.loc[i + j + 1, row.keys()] = row
                else:
                    number = historical_trials[
                        historical_trials["trial_name"] == name[:-1]
                    ]["number"]
                    repeated_trials.append(
                        [
                            item
                            for item in completed_trials_dicts
                            if number.values[0] == item["number"]
                        ]
                    )
            except Exception as e:
                exc_type, exc_obj, tb = sys.exc_info()
                line_number = tb.tb_lineno
                print(f"{traceback.format_exc()}\n")
                logger.info(f"{traceback.format_exc()}\n")
                error_trials.append(j)
                # _filtered_trials.append(i)
        if flag:
            return None

        tmp = copy.deepcopy(trial_hyper_params)
        error_trials = list(set(error_trials))

        print(
            f"Number of trials: {len(tmp)} -> {len(_filtered_trials)}, \n"
            f"Error_trials: {error_trials} is non-empty. \n"
            f"Repeated_trials: {repeated_trials} is non-empty."
        )
        logger.info(
            f"Number of trials: {len(tmp)} -> {len(_filtered_trials)}, \n"
            f"Error_trials: {error_trials} is non-empty. \n"
            f"Repeated_trials: {len(repeated_trials)} is non-empty. \n {repeated_trials}"
        )

        # for trial in trial_hyper_params:
        #     if trial["number"] not in new_number:
        #         trial.pop("number")

        return _filtered_trials, error_trials, repeated_trials
