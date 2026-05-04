"""
Author: Xiao Wu
LastEditTime: 2025-05-22 16:33:36
Copyright (c) 2025 by UESTC, All Rights Reserved.
"""

# %%
import os

# import json
import sys
import traceback

sys.path.append(r"C:\Projects\Xiao\agent")
from agent.parse_content import yaml2dict, parse_yaml, filtered_trials
from agent.client import Agent, CachedBase
import copy
import json
from functools import wraps
import openai
import time
import pandas as pd

# %%

rag_count = {0: "all", 1: 50, 2: 25, 3: 10}


def dummy_trials(trials, value_placeholder="{...}", number_placeholder="{...}"):
    result = []
    for trial in trials:
        anonymized = {
            "number": number_placeholder,
            "params": {k: value_placeholder for k in list(trial["params"].keys())},
        }
        result.append(anonymized)
    return json.dumps(result, indent=2)


def retry_on_api_error(func):
    max_retries = int(os.environ.setdefault("max_retries", "1"))
    retry_delay = int(os.environ.setdefault("retry_delay", "1"))

    @wraps(func)
    def wrapper(
        args,
        cognitive_agent,
        num_round,
        user,
        trial_param_name,
        merged_gt_results,
        gt_trials,
        cache=None,
        raw_chunk_size=None,
        logger=None,
    ):
        err = ""
        attempt = 0
        chunk_attemp = 0
        response_tasks = ""
        while True:
            if raw_chunk_size is not None:
                chunk_size = raw_chunk_size
            else:
                chunk_size = rag_count[chunk_attemp]
            try:
                response = func(
                    args,
                    cognitive_agent,
                    num_round,
                    user,
                    response_tasks,
                    trial_param_name,
                    merged_gt_results,
                    gt_trials,
                    cache,
                    chunk_size,
                    err,
                    logger,
                )
                (response_tasks, trial_hyper_params, number, err, status) = response
                if num_round >= len(gt_trials) or attempt >= max_retries:
                    return response_tasks, trial_hyper_params, number, err, status
                if (
                    err != ""
                    and attempt < max_retries
                    and "Answer: Yes" not in response_tasks
                ):
                    print(err)
                    attempt += 1
                    print(f"{func.__name__} is retrying {attempt}")
                    # chunk_attemp
                    continue
                elif (
                    len(trial_hyper_params) == 0 and "Answer: Yes" not in response_tasks
                ):
                    attempt += 1
                    cache.saved_messages[cache.saved_fname].pop(
                        f"{num_round}-find_trials-cognitive"
                    )
                    cache.saveas_json()
                    print(
                        f"{func.__name__} is retrying {attempt} because all recommended trials are unavailable."
                    )
                    # err = f"Recommended trials with number {number} are repeated.\n"
                    continue
                else:
                    return response_tasks, trial_hyper_params, number, err, status
            except Exception as e:
                exc_type, exc_obj, tb = sys.exc_info()
                line_number = tb.tb_lineno
                attempt += 1
                print(f"{traceback.format_exc()}\n")
                print(f"{func.__name__} is retrying {attempt}")
                if f"{num_round}-find_trials-cognitive" in cache.saved_messages.keys():
                    cache.saved_messages[cache.saved_fname].pop(
                        f"{num_round}-find_trials-cognitive"
                    )
                    cache.saveas_json()
                if args.auto_debug:
                    err = f"{type(e).__name__}: {e}"
                # print(f"{func.__name__} failed: {e} in Line: {line_number}")
                elif err == "Task 3: JSON Format, not found":
                    print(err)
                else:
                    raise e
            except KeyboardInterrupt as e:
                raise KeyboardInterrupt

    return wrapper


@retry_on_api_error
def chat_cognitive_rag(
    # args,
    args,
    cognitive_agent,
    num_round,
    user,
    response_tasks,
    trial_param_name,
    merged_gt_results,
    gt_trials,
    cache,
    chunk_size,
    err,
    logger=None,
):
    error = ""
    system_prompt = {
        "description": user[0]["content"]["description"],
        "instruction": user[0]["content"]["instruction"],
    }
    cognitive_prompt2 = """
    Completed trials:\n
    {completed_trials}\n
    The following **Search Space** contains **unexplored** trials.\n
    {trials}\n\n
    If optimization process should be stopped, Answer: Yes with confidence score: $confidence_socre. Otherwise, Answer: No with confidence score: $confidence_socre.\n
    Do not speculate beyond **Search Space**.\n
    Finally, you MUST output 'Answer: No/Yes' with confidence score: $confidence_socre\n\n
    """
    cognitive_prompt3 = """
    Instructions:\n
    **Search Space** (Numbering starts from 0, excluding Completed Trials):\n {trials}\n\n
    **Task 1: Optimization Recommendation**\n
    Recommend exactly {n_jobs} promising trials from the provided **Search Space** (include both number and params).\n
    - `params` MUST include:
    {keys}
    - All selected `params` must match exactly with the provided **Search Space**. Do NOT leave out any key.\n
    - Do not mix, modify, or create new values.\n
    - You MUST not output any JSON blocks in this part.\n
    - You MUST provide reasoning for each recommendation.\n
    ---
    ** Task 2 JSON Format **
    You response MUST be summarized as the following **JSON Format**:\n\n
    ## JSON Format:\n
    ```json
    [\n
        {{"number": ..., "params": {{...}}}}\n
    ]
    ```
    Do not use ellipses (...) or curly-brace placeholders ({{...}}). Fill in all values completely.
    """

    # - You MUST provide priority: high/medium/low for each recommendation.\n "priority": ...,
    # - You MUST include **all** of the following keys in each `params` field:
    #   ['ad0', 'ad1', 'ad10', 'ad11', 'ad12', 'ad13', 'ad14', 'ad2', 'ad3', 'ad4', 'ad5', 'ad6', 'ad7', 'ad8', 'ad9', 'dim', 'layers', 'lr', 'net', 'num_K', 'rbo', 'rounds', 'threshold', 'factor']
    # - All selected `params` must match exactly with the provided Search Space records. Do NOT leave out any key.

    cognitive_prompt4 = """
    Instructions:\n
    **Task 1: Review Analysis**\n
    {response}\n
    **Task 2: Fix Recommended Trials**\n
    The analysis in the last time leads a runtime error as follows (may be empty):\n
    {err}\n\n
    You MUST address and revise this error after completing the remaining tasks.
    """

    def chunk_list(lst, chunk_size):
        for i in range(0, len(lst), chunk_size):
            yield lst[i : i + chunk_size]

    used_trial_ids = [trial["number"] for trial in user[1]["content"]["trials"]]
    # trials = [{"number": number, 'params': trial['params']} for number, trial in enumerate(trials)]
    completed_trials_dicts = user[1]["content"]["trials"]
    trials = [
        {"number": number, "params": trial["params"]}
        for number, trial in enumerate(gt_trials)
        if number not in used_trial_ids
    ]
    # with open(f"{work_dir}/{dataset}_gt2.json", "w") as f:
    #     data = json.dump(trials, f, indent=4)

    # print(used_trial_ids)

    all_responses = []
    new_trial_hyper_params = []
    number = []
    success = False
    if chunk_size == "all":
        # system_prompt["search_space"] = (
        #     f"\nThe following chunked database is the search space:\n{trials} (Numbering starts from 0)\n"
        # )
        cognitive_agent = Agent(
            instruction=system_prompt,
            meta=args.dataset,
            role="cognitive",
            cache=cache,
        )
        # if err != "":
        #     err = (
        #         f"{response_tasks}. \nThe response in the last time runtime error:\n{err}\n"
        #     )
        #     response_tasks = cognitive_agent.temp_responses(
        #         err,
        #         action=f"{num_round}-find_trials",
        #     )
        # else:
        # print("## Understand Problem")
        # response = cognitive_agent.temp_responses(
        #     cognitive_prompt.format(
        #         trials=trials,
        #         stop_rule=args.stop_rule,
        #         completed_trials=json.dumps(completed_trials_dicts),
        #     ),
        #     action=f"find_trials-understand",
        # )

        # if num_round == args.n_jobs:
        #     logger.info(
        #         f"find_trials-understand-{cognitive_agent.role}: {response}"
        #     )

        # print("## Review Analysis of All Completed Trials")
        # response = cognitive_agent.temp_responses(
        #     cognitive_prompt1.format(
        #         trials=trials,
        #         stop_rule=args.stop_rule,
        #         completed_trials=completed_trials_dicts,# json.dumps(sorted(completed_trials_dicts[:-args.n_jobs], key=lambda x: x['validation accuracy'])[:20][::-1] + completed_trials_dicts[-args.n_jobs:]),
        #     ),
        #     action=f"{num_round}-find_trials-analyse",
        # )
        # logger.info(
        #     f"{num_round}-find_trials-analyse-{cognitive_agent.role}: {response}"
        # )
        # print("## Stop Optimization")

        if os.environ["com_flag"] == "greater":
            com_func = max
            com_func2 = lambda x, y: x>=y
        else:
            com_func = min
            com_func2 = lambda x, y: x <= y

        initial_results = com_func(
            [
                item[args.metric]
                for item in completed_trials_dicts[
                    : int(os.environ["completed_trials"])
                ]
            ]
        )
        best_results = com_func([item[args.metric] for item in completed_trials_dicts if args.metric in item.keys()])
        if (
            best_results
            not in completed_trials_dicts[: int(os.environ["completed_trials"])]
        ):
            if len(completed_trials_dicts) > int(os.environ["completed_trials"]):
                filtered_completed_trials_dicts = [
                        item[args.metric]
                        for item in completed_trials_dicts[
                            int(os.environ["completed_trials"]) :
                        ]  if args.metric in item.keys()
                    ]
                if filtered_completed_trials_dicts:
                    best_results = com_func(filtered_completed_trials_dicts)
                else:
                    best_results = initial_results
            else:
                best_results = initial_results

        stop_response = ""
        if (
            len(completed_trials_dicts) > int(os.environ["completed_trials"])
            and com_func2(best_results, initial_results)
            or len(trials) == 0
        ):
            stop_response = cognitive_agent.temp_responses(
                cognitive_prompt2.format(
                    # response_tasks=response,
                    stop_rule=args.stop_rule,
                    trials=trials,
                    metric=args.metric,
                    initial_trials=completed_trials_dicts[
                        : int(os.environ["completed_trials"])
                    ],
                    completed_trials=completed_trials_dicts,
                ),
                action=f"{num_round}-find_trials-stop",
            )
            logger.info("#" * 100)
            logger.info(
                f"{num_round}-find_trials-stop-{cognitive_agent.role}: {cognitive_agent.messages[-2]["content"]}"
            )
            logger.info("#" * 100)
            logger.info(
                f"{num_round}-find_trials-stop-{cognitive_agent.role}: {stop_response}"
            )
        if "Answer: Yes" in stop_response:
            return (
                stop_response,
                [],
                [],
                [],
                True,
            )
        else:
        # if True:
            response_tasks = cognitive_agent.temp_responses(
                    cognitive_prompt3.format(
                        trials=trials,
                        completed_trials=json.dumps(completed_trials_dicts),
                        keys=list(gt_trials[0]["params"].keys()),
                        n_jobs=min(args.n_jobs, len(trials)),
                        used_trial_ids=used_trial_ids,
                        examplers=dummy_trials(completed_trials_dicts[0:1]),
                        # stop_rule=args.stop_rule,
                        err=err,
                    ),
                    action=f"{num_round}-find_trials",
                )

            if err != "":
                response = cache.saved_messages[cache.saved_fname].pop(
                        f"{num_round}-find_trials-cognitive"
                    )
                cache.saveas_json()
                response_tasks = cognitive_agent.temp_responses(
                        cognitive_prompt4.format(response=response, err=err),
                        action=f"{num_round}-find_trials",
                    )
            logger.info(f"{num_round}-find_trials-{cognitive_agent.role}: {response_tasks}")
            if "</think>" in response_tasks:
                response_tasks = response_tasks.split("</think>")[1]
            new_trials, error = parse_yaml(response_tasks, logger=logger, fmt=args.fmt)
            trial_param_name = [name for name in trial_param_name]
            missing_key = []
            if new_trials is not None:
                # trial_hyper_params = [item for item in new_trials]
                success = True
                for item in new_trials:
                    trial_key = set(item["params"].keys())
                    tmp_missing_key = list(trial_key - set(trial_param_name))
                    tmp_missing_key += list(set(trial_param_name) - trial_key)
                    missing_key.extend(tmp_missing_key)
                    if not tmp_missing_key:
                        new_trial_hyper_params.append(item)

                if missing_key and args.auto_debug:
                    error = "{new_trials}. A KeyError occurred: the key '{missing_key}' was not found in Search Space.".format(
                        new_trials=new_trials,
                        missing_key=list(set(missing_key)),
                    )
                else:
                    completed_trials_dicts = user[1]["content"]["trials"]
                    new_trial_hyper_params, error_trials, repeated_trials = filtered_trials(
                        new_trial_hyper_params,
                        gt_trials,
                        merged_gt_results,
                        completed_trials_dicts,
                        trial_param_name,
                        metric=args.metric,
                        logger=logger,
                        closest_match=False,
                        keep_trials=True,
                    )

                    if error_trials and args.auto_debug:
                        error += """\nRecommended trials are not in the search space.
                                    \nDo not mix, modify, or create new values."""

                number = [item["number"] for item in new_trial_hyper_params]

            return (
                response_tasks,
                new_trial_hyper_params,
                number,
                error,
                success,
            )


@retry_on_api_error
def chat_rag(query, dataset, cache, chunk_size=25):
    #

    def chunk_list(lst, chunk_size):
        for i in range(0, len(lst), chunk_size):
            yield lst[i : i + chunk_size]

    used_trial_ids = [trial["number"] for trial in results[1]["content"]["trials"]]
    # trials = [{"number": number, 'params': trial['params']} for number, trial in enumerate(trials)]

    trials = [
        {"number": number, "params": trial["params"]}
        for number, trial in enumerate(trials)
    ]
    # with open(f"{work_dir}/{dataset}_gt2.json", "w") as f:
    #     data = json.dump(trials, f, indent=4)

    print(used_trial_ids)

    all_responses = []
    for idx, chunk in enumerate(chunk_list(trials, chunk_size)):
        prompt_rel = (
            f"The following chunked database is the search space:\n{chunk} (Numbering starts from 0)\n"
            f"Here is Recommended Trials:\n{used_trial_ids}"
        )

        agent = Agent(
            instruction=f"{prompt_rel}",
            meta=dataset,
            role="system",
            cache=cache,
        )

        print(f"Querying {query} in block {idx + 1}...")
        response = agent.temp_responses(
            f"""Find number: {list(query)}. Return trials (include number and params).
            Do not mix, modify, or create new values. 
            If a trial number is not found in the current block, do not return anything for it.
            Only respond in strict JSON format:\n"
            ```json
            [\n
            {{"number": ..., "params": {{...}}}}\n
            ]
            ```""",
            action="find_trials",
        )

        result = parse_yaml(response, fmt="json")
        if isinstance(result, list):
            filtered_result = [item for item in result if item["params"] is not None]
            all_responses.extend(filtered_result)
            query = query - set([item["number"] for item in filtered_result])
        # all_responses.append(response)

    summary_agent = Agent(
        instruction="You are a summarizer. Combine all extracted trials into a single clean list. "
        "Do not duplicate, and ensure all trials include their number and parameters clearly.",
        role="system",
        meta=dataset,
        model_info="gpt-4.1-mini",
    )
    combined_response = "\n\n".join(all_responses)

    # 汇总输出
    final_summary = summary_agent.temp_responses(
        f"The following are extracted trials from different blocks:\n{combined_response}\n\n"
        "Please merge them into a single final list."
    )

    print("\n=== Final Summary ===")
    print(final_summary)

    return final_summary


if __name__ == "__main__":
    dataset = [
        r"CV/LCBench_FashionMnist_Classification",
        r"MIA/nnUnet_params_2",
        r"MIA/nnUnet_BTCV",
    ][0]

    os.environ["work_dir"] = r"C:\Projects\Xiao\SelfAI\completion"
    os.environ["cache_path"] = dataset
    os.environ["cached_mode"] = ""

    model_name_list = ["gpt-4.1-mini"][0]

    os.environ["OPENAI_API_KEY"] = os.environ.get("OPENAI_API_KEY", "")
    with open(f"{os.environ["work_dir"]}/{dataset}_gt.json", "r") as f:
        data = json.load(f)
    trials = data[1]["content"]["trials"]

    with open(
        f"{os.environ["work_dir"]}/{os.path.dirname(dataset)}/{model_name_list}/{os.path.basename(dataset)}_train_{model_name_list}.json",
        "r",
    ) as f:
        results = json.load(f)

    query = set([2, 79, 534, 1500, 1990])
    cache = CachedBase()
    cache.init(saved_fname=dataset)
    result = chat_cognitive_rag(query, dataset, model_name_list, cache)

# %%
