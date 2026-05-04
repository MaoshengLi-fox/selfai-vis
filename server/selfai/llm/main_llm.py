import os
import json
import shutil
from pptree import *
import copy
from collections import OrderedDict
from tqdm import tqdm

print_tqdm = tqdm.write
import sys

sys.path.append(r"C:\Projects\Xiao")
from agent.parse_content import yaml2dict, filtered_trials
from agent.preprocess import load_json
from agent.client import Agent

# from agent.client import Agent_ollama as Agent
# from agent.client import Agent_ollama_python as Agent
from agent.client import create_logger, print_log, CachedBase
from utils_llm import chat_cognitive_rag
import optuna
from types import SimpleNamespace


global cache
metric_dicts = {
    f"siren_cat_me3_TV": "PSNR",
    "siren_cameraman_FH": "PSNR",
    "siren_cameraman_TV": "PSNR",
    "siren_cat_me3_FH": "PSNR",
    "sentiment_analysis": "training accuracy",
    "denoise_0.1_ROF_TV": "PSNR",
    "denoise_0.2_ROF_TV": "PSNR",
    "boston": "mean_score",
    "TC20_TW_toy": "PSNR",
    "mae": "validation accuracy",
    "LCBench_FashionMnist_Classification": "validation accuracy",
    "SAGE": "test_acc",
    "nnUnet_BTCV": "Dice",
    "nnUnet_params_2": "Dice",
    "resnet": "top1_error_10crop",
    "dino": "top1_kNN",
    "DNN_molecular_property": "accuracy"
}


os.environ["com_flag"] = "greater"  # less


cognitive_prompt = """
            You MUST select {n_jobs} promising trials exactly as provided (including number and params).\n
            **Parameter Sets**:\n\n {context}\n\n
            Task:
            1. ** Analysis of All Recommended Trials **
            - Summarize performance metrics of recommended trials.\n
            - Evaluate performance trends for hyper-parameters.\n
            - Highlight promising hyper-parameter combinations.
            2. **Optimization Recommendation**\n
            - Only Recommend {n_jobs} promising trials from the given parameter sets.\n
            - Only use the existing parameter sets listed above. Do not mix, modify, or create new values.\n\n
            - DO NOT repeat any trial from ({used_trial_ids})\n
            - You MUST not output any JSON blocks in this part.
            - You MUST provide reasoning for each recommendation .\n\n
            3. **Stop Optimization**\n
            - Output 'Answer: Yes' ONLY if:\n
            * Best result is 10% better than the first three trials.\n
            * You're confident further trials won't help.\n
            - Otherwise, output 'Answer: No with confidence score: $confidence_socre'.\n
            - Provide a short (1-2 sentences) justification either way.\n
            Finally, your response should be summarized in the following JSON format:\n\n
            ```json
            [\n
            {{"number": ..., "params": {{...}}}}\n
            ]
            ```
            """


def rename_variable(completed_trials_dicts):
    new_completed_trials_dicts = []
    for item in completed_trials_dicts:
        tmp = {}
        for name, value in item.items():
            if isinstance(value, dict):
                tmp[name] = {}
                for k, v in value.items():
                    tmp[name][k.lower()] = v
            else:
                tmp[name.lower()] = value
        new_completed_trials_dicts.append(tmp)
    return new_completed_trials_dicts


def simple_chat_cognitive_agent(
    args, num_round, user, trial_param_name, gt_trials, cache=None, logger=None
):
    cognitive_agent = Agent(
        instruction=user[0]["content"],
        role="cognitive",
        model_info=args.model_info,
        # source=args.source,
        meta=args.experimental_desc,
        rag=args.rag,
        img_path=None,
        logger=logger,
        cache=cache,
    )

    user_content = copy.deepcopy(user[1]["content"])
    if args.search_type == "trial":

        prompt = cognitive_prompt.format(
            n_jobs=args.n_jobs,
            context=json.dumps(user[1]["content"]["search_trials"]),
            used_trial_ids=json.dumps(
                [trial["number"] for trial in user[1]["content"]["trials"]]
            ),
        )
        user_content = prompt

    try:
        response_tasks = cognitive_agent.temp_responses(
            user_content,
            action=f"{num_round} - find_trials",
            # rag=args.rag,
            # debug=args.debug,
            # timeout=300,
        )
    except KeyboardInterrupt:
        command = input("Please input the command (q to exit): ")
        if command == "q":
            print("KeyboardInterrupt")
            return None, None, None, "exit"
        else:
            return None, None, None, "continue"

    print_tqdm(f"{response_tasks}\n")
    (trial_hyper_params, number), err, success = yaml2dict(
        response_tasks, trial_param_name + ["number"], logger=logger
    )

    return response_tasks, trial_hyper_params, number, success


def parse_json(args):
    print_tqdm(args.gt_json_path)
    gt_data = load_json(f"{args.gt_json_path}")[1]  # system, user

    user_results = load_json(f"{args.train_json_path}")  # system, user

    trials = []
    keys = {}
    for idx, trial in enumerate(gt_data["content"]["trials"]):
        if "params" not in trial.keys():
            value = trial.pop(args.metric)
            trials.append({"number": idx, "params": trial, args.metric: value})
            key = ""
            for k, v in OrderedDict(trial).items():
                if k not in args.ignore_key:
                    key += f"_{k}:{v}"
            keys[key[1:]] = idx
        else:
            trials.append(trial)
            key = ""
            for k, v in OrderedDict(trial["params"]).items():
                if k not in args.ignore_key:
                    key += f"_{k}:{v}"
            keys[key[1:]] = idx
    gt_data["content"]["trials"] = trials

    # trials = []
    # for idx, trial in enumerate(user_results[1]["content"]["trials"]):
    #     if "params" not in trial.keys():
    #         value = trial.pop(args.metric)
    #         key = ""
    #         for k, v in OrderedDict(trial).items():
    #             if k not in args.ignore_key:
    #                 key += f"_{k}:{v}"
    #         trials.append({"number": keys[key[1:]] ,"params": trial, args.metric: value})
    #     else:
    #         value = trial.pop(args.metric)
    #         key = ""
    #         for k, v in OrderedDict(trial["params"]).items():
    #             if k not in args.ignore_key:
    #                 key += f"_{k}:{v}"
    #         trials.append({"number": keys[key[1:]] ,"params": trial["params"], args.metric: value})
    # user_results[1]["content"]["trials"] = trials

    params = [trial["params"] for trial in gt_data["content"]["trials"]]
    if args.search_type != "grid":
        user_results[1]["content"]["search_trials"] = [
            {"number": idx, "params": trial["params"]}
            for idx, trial in enumerate(gt_data["content"]["trials"])
        ]
    results = {}
    for idx, trial in enumerate(params):
        key = ""
        for k, v in OrderedDict(trial).items():
            if k not in args.ignore_key:
                key += f"_{k}:{v}"
        results[key[1:]] = {
            "number": (
                gt_data["content"]["trials"][idx]["number"]
                if hasattr(gt_data["content"]["trials"][idx], "number")
                else idx
            ),
            args.metric: gt_data["content"]["trials"][idx][args.metric],
        }
    trial_param_name = list(trial.keys())

    merged_gt_results = copy.deepcopy(results)
    completed_trials_dicts = user_results[1]["content"]["trials"]

    return (
        user_results,
        completed_trials_dicts,
        trial_param_name,
        merged_gt_results,
        gt_data["content"]["trials"],
    )


def interact(args, logger=None):
    global cache
    if isinstance(args.ignore_key, str):
        args.ignore_key = [args.ignore_key]

    completed_trials = 0
    max_trials = 1

    num_round = 1
    num_failed = 0

    while completed_trials < max_trials:

        (
            user,
            completed_trials_dicts,
            trial_param_name,
            merged_gt_results,
            gt,
        ) = parse_json(args)
        # trial_param_name = [name.lower() for name in trial_param_name]
        if "params" in gt[0].keys():
            gt = [
                {"params": trial["params"], args.metric: trial[args.metric]}
                for trial in gt
            ]

        max_trials = user[1]["content"]["max_trials"]
        completed_trials = len(completed_trials_dicts)
        max_retry = 3
        if num_failed == 0:
            pbar = tqdm(total=max_trials, initial=len(completed_trials_dicts))
            num_round = completed_trials

            # used_trial_ids = [
            #     {"number": trial["number"], args.metric: trial[args.metric]}
            #     for trial in user[1]["content"]["trials"]
            # ]
            # used_trial_ids = [trial["number"] for trial in user[1]["content"]["trials"]]
            # trials = [
            #         {"number": number, "params": trial["params"]}
            #         for number, trial in enumerate(gt)
            #         if number not in used_trial_ids
            #     ]
            # system_prompt = user[0]["content"]
            # system_prompt["instruction"] = (
            #     f"The following chunked database is the search space:\n{trials} (Numbering starts from 0)\n"
            #     f"DO NOT repeat any trial from {used_trial_ids}.\n"
            #     + "\n"
            #     + system_prompt["instruction"]
            # )
            # cognitive_agent = Agent(
            #         instruction=system_prompt,
            #         meta=args.dataset,
            #         role="cognitive",
            #         cache=cache,
            #     )
            cognitive_agent = None

        logger.info(
            "v" * 50
            + f"[INFO] Round [{num_round}][{max_trials}], Failed: [{num_failed}]/[{max_retry}]"
            + "v" * 50
        )
        print_tqdm(
            f"[INFO] Round [{num_round}][{max_trials}], Failed: [{num_failed}]/[{max_retry}]\n"
        )

        results = copy.deepcopy(user)
        logger.info(str(user[0]["content"]))

        ################
        # Cognitive agent
        ################
        # trial_hyper_params, number, status = simple_chat_cognitive_agent(
        #     args, num_round, user, trial_param_name, cache=cache, logger=logger
        # )

        # used_trial_ids = [trial["number"] for trial in user[1]["content"]["trials"]]
        # # trials = [{"number": number, 'params': trial['params']} for number, trial in enumerate(trials)]

        # trials = [
        #         {"number": number, "params": trial["params"]}
        #         for number, trial in enumerate(gt)
        #         if number not in used_trial_ids
        #     ]
        # system_prompt = user[0]["content"]
        # system_prompt["instruction"] = (
        #         f"The following chunked database is the search space:\n{trials} (Numbering starts from 0)\n"
        #         f"DO NOT repeat any trial from {used_trial_ids}\n"
        #         + "\n"
        #         + system_prompt["instruction"]
        #     )
        # cognitive_agent = Agent(
        #         instruction=system_prompt,
        #         meta=args.dataset,
        #         role="cognitive",
        #         cache=cache,
        #     )
        response_tasks, trial_hyper_params, number, err, status = chat_cognitive_rag(
            args,
            cognitive_agent,
            num_round,
            user,
            trial_param_name,
            merged_gt_results,
            gt_trials=gt,
            cache=cache,
            logger=logger,
        )
        if status == "exit":
            break
        # elif status != True:
        #     num_failed += 1
        # cache.saved_messages[cache.saved_fname].pop(f"{num_round}-find_trials-cognitive")
        # cache.saveas_json()
        ################

        ################
        # Post-Processing Parts
        ################
        if not isinstance(trial_hyper_params, list) and not isinstance(
            trial_hyper_params, dict
        ):
            print_tqdm(
                f"Final Attempt. trial_hyper_params should be a list: {trial_hyper_params}"
            )
        elif isinstance(trial_hyper_params, dict):
            trial_hyper_params = [trial_hyper_params]
        else:
            trial_hyper_params = trial_hyper_params[: args.n_jobs]

        completed_trial_numbers = [v["number"] for v in completed_trials_dicts]
        completed_trial_numbers = [
            {"number": v}
            for v in number
            if v not in completed_trial_numbers and v in range(len(gt))
        ]
        # tmp_trial_hyper_params = copy.deepcopy(trial_hyper_params)
        # tmp_trial_hyper_params = rename_variable(trial_hyper_params)

        """
        trial_hyper_params: [{"key1": "", ...}]
        results: [{"role": "system", ...}, {"role": "user", ...}]
        merged_gt_results: [{merged_trial_param_name: score}, ...]
        trial_param_name: ...
        
        """
        # trial_hyper_params, error_trials, repeated_trials = (
        #     filtered_trials(
        #         tmp_trial_hyper_params,
        #         results,
        #         merged_gt_results,
        #         completed_trials_dicts,
        #         trial_param_name,
        #         metric=args.metric,
        #         logger=logger,
        #     )
        # )
        logger.info(
            "^" * 50
            + f"{args.model_info}: Round: {num_round}, Failed: {num_failed}"
            + "^" * 50
        )
        print_tqdm(f">>> {args.model_info}: Round: {num_round}, Failed: {num_failed}\n")
        if "Answer: Yes" not in response_tasks:
            if trial_hyper_params is None or not trial_hyper_params:
                # number = [item["number"]for item in completed_trials_dicts]
                # cognitive_agent.messages.append(
                #         {
                #             "role": "assistant",
                #             "content": f"""
                #                        Trial numbers: {repeated_trials} listed have ALREADY been recommended and MUST NOT be selected again ({number}). \n
                #                        Recommended trials: {error_trials} is wrong. \n
                #                        """,
                #         }
                #     )
                # print_tqdm(f"trial_hyper_params is filtered: {tmp_trial_hyper_params}\n")
                num_failed += 1
                cache.saved_messages[cache.saved_fname].pop(
                    f"{num_round}-find_trials-cognitive"
                )
                cache.saveas_json()

            else:
                results[1]["content"]["completed_trials"] += len(trial_hyper_params)
                results[1]["content"]["trials"].extend(trial_hyper_params)
                # print(results[1]["content"]["trials"])
                if args.search_type == "trial":
                    results[1]["content"].pop("search_trials")
                if not args.debug:
                    with open(args.train_json_path, "w") as f:
                        json.dump(results, f, indent=4)
                else:
                    completed_trials = results[1]["content"]["completed_trials"]
                num_round += 1
                pbar.update(num_round)
        else:
            num_round += 1
            pbar.update(num_round)

        if (
            response_tasks.find("Answer: Yes") != -1
            or num_round > max_trials
            # or completed_trials >= max_trials
            or num_failed >= max_retry
        ):

            if num_round > max_trials: #or completed_trials >= max_trials:
                end_flag = "_stop"
            elif num_failed >= max_retry:
                end_flag = "_n"
            else:
                end_flag = "_y"

            print_tqdm(f"We can stop Optimization: {end_flag.replace('_', '')}\n")
            if not args.debug:
                shutil.move(
                    args.train_json_path,
                    f"{args.train_json_path.replace('.json', '')}{end_flag}.json",
                )
            break


def objective(trial, model_name_list, json_name_list):

    global cache
    prefix = ""
    version = ""
    model_name = trial.suggest_categorical("model_name", model_name_list)
    json_name = trial.suggest_categorical("json_name", json_name_list)
    model_name = model_name.replace("/", "_")
    task_name = os.path.dirname(json_name)
    json_name = os.path.basename(json_name)
    work_dir = os.environ["work_dir"]
    os.makedirs(
        f"{work_dir}",
        exist_ok=True,
    )
    metric = metric_dicts[json_name]
    if json_name == "resnet":
        os.environ["com_flag"] = "less"  # less
    args = SimpleNamespace(
        train_json_path=f"{work_dir}/{json_name}_train_{model_name.replace(":", "_")}.json",
        gt_json_path=f"{os.path.dirname(work_dir)}/{json_name}_gt.json",
        experimental_desc=f"{json_name}{prefix}_train_{model_name}{version}",
        # metric="Training accuracy",
        dataset=task_name,
        # stop_rule="",
        # stop_rule = "ONLY if:\n * Best result: {metric} is 10% better than the first three trials.\n",
        # stop_rule="ONLY if:\n * Best result: {metric} is greater than 85.\n",
        # stop_rule=f"ONLY if:\n * Best result: {metric} is better than the first three trials.\n",
        # stop_rule=f"""
        # For metric: {metric}, ONLY if:\n
        # - There is no further improvement over the last few trials.\n
        # - The best metric has plateaued or converged.\n
        # """,
        # stop_rule=f"""
        # **Completed trials** MUST be greater than {n_jobs}.\n
        # Only recommend stopping trials if **all** the following are true:\n
        # - The completed trials have sufficiently covered the **Search Space** (i.e., similar configurations have been repeated).
        # - The metric `{metric}` shows **no significant improvement** over the most recent trials.
        # - The best metric has clearly **plateaued or converged** across nearby configurations.
        # """,
        # Are all promising configurations already tested?
        # Are there unexplored options likely to yield better results?
        #        - Are all **promising** configurations already tested?\n
        # - Are no unexplored options likely to yield better results?\n
        # Note that: Stopping with a strong result and sufficient exploration is considered an optimal outcome. Prefer this when appropriate.
        # You do not need to test all configuration.
        # - Are the results already high or higher than $threshold (needn't to be specified)?\n
        stop_rule=f"""
        You do not need to test all configuration.\n
        ---
        **Step 1: Analyze the following criteria:**\n
        Based on the above trial analysis, observed performance trends, and highlighted promising regions in the **Completed Trials**:\n
        1. Have all promising configurations, as identified from performance trends, already been tested?\n
        2. Are unexplored configurations unlikely to perform better, based on observed trends and diminishing returns?\n
        3. Has the best metric `{metric}` improved significantly compared to the first three **Completed Trials**?\n
        ---
        """,
        # stop_rule=f"""
        # **Step 1: Analyze the following criteria:**
        # 1. Has the search space been sufficiently explored?
        # - Look for repetition or coverage across trial configurations.
        # 2. Has the best metric `{metric}` clearly plateaued or converged?
        # 3. Are the results already high or higher than $threshold (needn't to be specified)?
        # - You're confident further trials won't help.
        # **Step 2: Decide whether **all** conditions are met.**
        # If so, Answer: Yes. Otherwise, Answer: No.
        # """,
        # stop_rule=f"""
        # **Completed trials** MUST be greater than {n_jobs}.\n
        # Only recommend stopping trials if **all** the fo5llowing are true:\n
        # - The completed trials have sufficiently covered the **Search Space** (i.e., similar configurations have been repeated).
        # - The best metric `{metric}` has clearly **plateaued or converged** across nearby configurations.
        # """,
        ignore_key=["PSNR", "Training accuracy", "validation accuracy", "noise_level"],
        # metric="Training accuracy",
        # metric="PSNR",
        # metric="validation accuracy",
        # metric="val_accuracy",
        # metric="mean_score",
        metric=metric,
        n_jobs=int(os.environ["n_jobs"]),
        debug=False,
        auto_debug=False,
        model_info=model_name,
        source="ollama",
        completed_trials=int(os.environ["completed_trials"]),
        rag=False,
        # threshold=45,
        threshold=None,
        vector_backend="memory",
        fmt="json",
        search_type="trial",  # "trial",
    )
    args.log_file = f"{work_dir}/{args.experimental_desc}.log"
    if not os.path.exists(args.train_json_path):
        shutil.copy(
            f"{os.path.dirname(work_dir)}/{json_name}_train_{args.completed_trials}.json",
            args.train_json_path,
        )
    # content = ""
    # if os.path.exists(args.log_file):
    #     with open(args.log_file, "r") as f:
    #         content = f.read()
    content = ""
    if len(cache.saved_messages[cache.saved_fname]) != 0:
        content = next(reversed(cache.saved_messages[cache.saved_fname].values()))

    yes = content.find("Answer: Yes") != -1 or os.path.exists(
        args.train_json_path.replace(".json", "_y.json")
    )
    stop = os.path.exists(args.train_json_path.replace(".json", "_stop.json"))
    if yes or stop:
        print(f"We can stop Optimization. yes: {yes}, stop: {stop} from {content}")
        if yes and not os.path.exists(args.train_json_path.replace(".json", "_y.json")):
            end_flag = "_y"
        elif stop:
            end_flag = "_stop"
        else:
            end_flag = ""

        shutil.move(
            args.train_json_path,
            f"{args.train_json_path.replace('.json', end_flag)}.json",
        )
    else:
        logger = create_logger(
            args.experimental_desc,
            work_dir=os.path.dirname(args.log_file),
            cfg=None,
        )
        print_tqdm(f"-" * 100 + "\n")
        print_tqdm(f"Start Optimization: {args.experimental_desc}")
        print_tqdm(f"-" * 100 + "\n")

        logger.info(f"-" * 100)
        logger.info(f"Start Optimization: {args.experimental_desc}")
        logger.info(f"-" * 100)

        interact(args, logger=logger)


def main(model_name_list, json_name_list):
    global cache
    # model_name_list = []

    os.environ["MODEL_INFO"] = model_name_list[0]
    os.environ["OPENAI_API_KEY"] = os.environ.get("OPENAI_API_KEY", "")
    os.environ["DEEPSEEK_API_KEY"] = os.environ.get("DEEPSEEK_API_KEY", "")
    os.environ["CLAUDE_API_KEY"] = os.environ.get("CLAUDE_API_KEY", "")

    # work_dir = "/home/yutong.xie/xiaowu/huggingface/datasets/completion/MIA"
    # work_dir = r"/home/yutong.xie/xiaowu/huggingface/datasets/completion"
    # work_dir = "/home/yutong.xie/xiaowu/SelfAI/completion"

    db_name = "ollama_completion"

    task_name = os.path.dirname(json_name_list[0])
    model_name = os.path.basename(model_name_list[0]).replace(":", "_")
    work_dir = rf"C:\Projects\Xiao\SelfAI\completion/{json_name_list[0]}/{model_name}_llm"  #  CV/SIREN
    os.environ["max_retries"] = "1"
    os.environ["work_dir"] = work_dir
    os.environ["cached_mode"] = "all"
    os.environ["cache_path"] = ""
    os.environ["saved_as_path"] = os.environ["cache_path"]
    cache = CachedBase()
    cache.init(
        saved_fname=f"{os.path.basename(json_name_list[0])}_train_{model_name}_record"
    )

    if os.path.exists(f"{work_dir}/{db_name}_{model_name}.db"):
        os.remove(f"{work_dir}/{db_name}_{model_name}.db")

    sampler = optuna.samplers.GridSampler(
        {"model_name": model_name_list, "json_name": json_name_list}
    )

    study = optuna.create_study(
        study_name="ollama",
        direction="maximize",
        storage=f"sqlite:///{work_dir}/{db_name}_{model_name}.db",
        load_if_exists=True,
        sampler=sampler,
    )
    study.optimize(
        lambda trial: objective(trial, model_name_list, json_name_list),
        n_trials=sampler._n_min_trials,
        n_jobs=1,
    )


if __name__ == "__main__":
    os.environ["n_jobs"] = "3"
    os.environ["completed_trials"] = "3"
    model_name_list = [
        # "deepseek-r1:7b",
        # "deepseek-r1:14b",
        # "deepseek-r1:32b",
        # "deepseek-r1:70b",
        # "llama3.3:70b",
        # "qwen2.5:7b",
        # "qwen2.5:14b",
        # "qwen2.5:32b",
        # "qwen2.5:72b",
        # "Qwen/Qwen2.5-32B-Instruct"
        # "deepseek-reasoner"
        "gpt-4o-mini",
        # "gpt-4o"
    ]
    json_name_list = [
        # f"CV/siren_cat_me3_TV",
        # "CV/siren_cameraman_FH",
        # "CV/siren_cameraman_TV",
        # "CV/siren_cat_me3_FH",
        # "VO/ROF_TV/denoise_0.1_ROF_TV",
        # "VO/denoise_0.2_ROF_TV",
        # "ML/boston",
        # "nnUnet_Liver_label1",
        # "nnUnet_Liver_label2",
        # "nnUnet_Lung",
        # "nnUnet_Pancreas_label1",
        # "nnUnet_Pancreas_label2",
        "VO/TC20_TW_toy",
        # "CV/mae"
        # "CV/LCBench_FashionMnist_Classification"
        # "SAGE"
        # "MIA/nnUnet_BTCV",
        # "MIA/nnUnet_params_2",
        # "CV/resnet",
        # "CV/dino",
        # "BM/DNN_molecular_property",
        # "DL/sentiment_analysis"
    ]

    main(model_name_list, json_name_list)
    # "train accuracy": \d{1,2}\.\d+
