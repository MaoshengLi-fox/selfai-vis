import os
import sys

import json
import shutil
try:
    from pptree import *
except ImportError:
    pass
import copy
from collections import OrderedDict
import yaml
from utils.client import Agent, create_logger, print_log


def load_json(json_file):
    with open(json_file, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_yaml(response_tasks, fmt="yaml", logger=None):
    yaml_content = {}
    if fmt in response_tasks:
        try:
            yaml_start = response_tasks.index(fmt) + len(f"{fmt}\n")
            yaml_end = response_tasks.index("```", yaml_start)
            yaml_content = response_tasks[yaml_start:yaml_end].strip()
        except Exception as e:
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
            return data
        else:
            return None
    except Exception as e:
        print(e)
        return None


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
    args,
    trial_hyper_params,
    number,
    results,
    merged_gt_results,
    completed_trials_dicts,
    trial_params,
    logger=None,
):
    keys = list(merged_gt_results.keys())
    error_trials = []
    repeated_trials = []
    new_number = []
    flag = False

    for i, param in enumerate(completed_trials_dicts):
        name = ""
        for k in trial_params:
            if "params" in param.keys():
                name = name + f"{k}:{param['params'][k]}_"
            else:
                name = name + f"{k}:{param[k]}_"
        repeated_trials.append(name[:-1])

    for i, param in enumerate(trial_hyper_params):
        name = ""
        try:
            for k in trial_params:
                if "params" in param.keys():
                    name = name + f"{k}:{param['params'][k]}_"
                else:
                    name = name + f"{k}:{param[k]}_"
        except Exception as e:
            flag = True
            print("error: ", e)
            break
        if name[:-1] not in repeated_trials:
            try:
                param[args.metric] = merged_gt_results[name[:-1]]
                new_number.append(keys.index(name[:-1]))
                repeated_trials.append(name[:-1])
            except Exception as e:
                print("Filtered_trials, IndexError: ", e)
                error_trials.append(i)
        else:
            error_trials.append(i)

    if flag:
        return None

    tmp = copy.deepcopy(trial_hyper_params)
    error_trials = list(set(error_trials))
    trial_hyper_params = [
        {
            "number": (
                new_number[i]
                if len(new_number) == (len(trial_hyper_params) - len(error_trials))
                else i + len(results[1]["content"]["trials"])
            ),
            args.metric: trial_hyper_params[i].pop(args.metric),
            "params": trial_hyper_params[i],
        }
        for i in range((len(trial_hyper_params) - len(error_trials)))
        if i not in error_trials
    ]
    print_log(
        f"{len(tmp)} -> {len(trial_hyper_params)}, because error_trials={error_trials} is non-empty (repeated_trials: {len(repeated_trials)} should be empty)",
        logger=logger,
    )
    # for trial in trial_hyper_params:
    #     if trial["number"] not in new_number:
    #         trial.pop("number")

    return trial_hyper_params
