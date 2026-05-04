"""
Author: Xiao Wu
LastEditTime: 2025-05-22 16:33:36
Copyright (c) 2025 by UESTC, All Rights Reserved.
"""


import os
import sys
import traceback
import copy
import json
from functools import wraps
import openai
import time
import pandas as pd


from utils.utils import yaml2dict, parse_yaml, filtered_trials
from utils.client import Agent, CachedBase


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
    system_prompt = user[0]["content"]
    # You MUST select {n_jobs} promising trials exactly as provided (including number and params).\n
    # The response in the last time runtime error:\n
    # {err}
    # The following chunked database is the search space:\n{trials} (Numbering starts from 0)\n"
    # You MUST complete Task 1 before Task 2.
    # \n

    cognitive_prompt = """
    ** Task 1: Analyze current task**\n
        Understand current tasks, basic_idea, objective and hyperparameters.\n
    """
    # node classification tasks, including
    # Analyze current task and Understand basic_idea and hyperparameters.\n
    cognitive_prompt1 = """
    Completed trials (Descending Order and Most Recent Recommendation):\n
    {completed_trials}\n
    ** Task 1: Analyze current task**\n
    Understand current tasks, basic_idea, objective and hyperparameters.\n
    ** Task 2: Analysis of Completed Trials**\n
    Step 1: Summarize performance metrics for completed trials.\n
    Step 2: Evaluate performance trends for hyper-parameters.\n
    Step 3: Highlight promising hyper-parameter combinations.\n
    - Begin by identifying all **Top-performing configurations**\n
    Notes:\n
    - Avoid repeating the same phrases or observations.\n
    - Do not restate identical trial configurations or results.\n
    - Ensure each insight is unique and adds new information.\n
    - Group similar trends together instead of describing each trial individually.\n
    """

    # cognitive_prompt2 = """
    # Evaluate whether stop optimization.\n
    # If continue, Answer: No\n
    # You MUST output 'Answer: No/Yes' with confidence score: $confidence_socre\n\n
    # Provide a short (1-2 sentences) justification either way.\n\n
    # Instructions:\n
    # ** Review Analysis of All Completed Trials**\n
    # {response_tasks}\n
    # **Decide Whether to Stop Optimization**\n
    # {stop_rule}\n
    # Completed trials:\n
    # {completed_trials}\n
    # The following chunked database is the **Search Space** (Numbering starts from 0):\n {trials}\n\n
    # Finally, you MUST output 'Answer: No/Yes' with confidence score: $confidence_socre\n\n
    # Provide a short (1-2 sentences) justification either way.\n\n
    # ** Task 2: Analysis of Search Space**\n
    # Determine whether all promising configurations (within the given search space) have already been tested.\n
    # [\n
    # {{"number": ..., "params": {{...}}}}\n
    # ]
    """
    Based on above analysis in ** Task 1** (trial analysis, performance trends, highlights and more insights),
    recommend exactly {n_jobs} promising trials as **Search Space** provided (including number and params).\n
    Use the provided **Search Space** as the full boundary of valid configurations.  
    Rely on insights from **Task 1** and **Task 2** to assess unexplored but promising options.  
    Do not speculate beyond the defined space.
    Focus on performance trends, and highlighted trials\n
    {response_tasks}\n
    """
    # """
    cognitive_prompt2 = """
    Completed trials:\n
    {completed_trials}\n
    The following **Search Space** contains **unexplored** trials.\n
    {trials}\n\n
    Instructions:\n
    ** Task 1: Review Analysis of Completed Trials (trial analysis, performance trends, highlights and other insights)**\n
    ** Task 2: Decide Whether to Stop Optimization**\n
    Based on the above analysis and **Completed Trials**, determine whether the optimization process should be stopped.\n
    Carefully analyze each of the following stop rules and provide a short (1-2 sentences) justification for whether it is met:\n
    {stop_rule}\n
    **Step 2: Decide whether **all** conditions are met.**\n
    If **all** criteria in Step 1 are met or early stopping,\n
    Answer: Yes with confidence score: $confidence_socre. Otherwise, Answer: No with confidence score: $confidence_socre.\n
    Note that: **You MUST complete Step 1 before Step 2.** 
    Do not speculate beyond **Search Space**.\n
    Finally, you MUST output 'Answer: No/Yes' with confidence score: $confidence_socre\n\n
    """

    # cognitive_prompt2 = """
    # Instructions:\n
    # ** Task 1: Review Analysis of Completed Trials**\n
    # ** Task 2: Decide Whether to Stop Optimization**\n
    # Based on the above, decide whether to stop the optimization process.
    # {stop_rule}\n
    # Provide a short (1-2 sentences) justification either way.\n\n
    # """
    # Recommend exactly {n_jobs} promising trials from the provided **Search Space** (include both number and params).
    # - Use the analysis in **Task 1** to guide selection, while also actively exploring under-explored areas of the **Search Space**.
    # The response in the last time maybe have runtime error as follows (may be empty):\n
    # {err}\n\n
    # You MUST address and revise this error after completing the remaining tasks.
    cognitive_prompt3 = """
    Instructions:\n
    **Task 1: Review Analysis of All Completed Trials**\n
    Completed trials:\n
    {completed_trials}\n
    The following chunked database is the **Search Space** (Numbering starts from 0, excluding Completed Trials):\n {trials}\n\n
    Instructions:\n
    **Task 2: Optimization Recommendation**\n
    Recommend exactly {n_jobs} promising trials from the provided **Search Space** (include both number and params).\n
    - `params` MUST include:
    {keys}
    - All selected `params` must match exactly with the provided **Search Space**. Do NOT leave out any key.\n
    - Use the analysis in **Task 1** (trial analysis, performance trends, highlights and other insights) to guide selection.\n
    - Based on the above analysis, explore under-explored regions only when there is clear evidence of potential performance gain.\n
    - Do not mix, modify, or create new values.\n
    - You MUST not output any JSON blocks in this part.\n
    - You MUST provide reasoning for each recommendation.\n
    ---
    ** Task 3 JSON Format **
    You response MUST be summarized as the following **JSON Format**:\n\n
    ## JSON Format:\n
    ```json
    [\n
        {{"number": ..., "params": {{...}}}}\n
    ]
    ```
    Do not use ellipses (...) or curly-brace placeholders ({{...}}). Fill in all values completely.
    """
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

        print("## Review Analysis of All Completed Trials")
        response = cognitive_agent.temp_responses(
            cognitive_prompt1.format(
                trials=trials,
                stop_rule=args.stop_rule,
                completed_trials=completed_trials_dicts,# json.dumps(sorted(completed_trials_dicts[:-args.n_jobs], key=lambda x: x['validation accuracy'])[:20][::-1] + completed_trials_dicts[-args.n_jobs:]),
            ),
            action=f"{num_round}-find_trials-analyse",
        )
        logger.info(
            f"{num_round}-find_trials-analyse-{cognitive_agent.role}: {response}"
        )
        print("## Stop Optimization")

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
        best_results = com_func([item[args.metric] for item in completed_trials_dicts])
        if (
            best_results
            not in completed_trials_dicts[: int(os.environ["completed_trials"])]
        ):
            if len(completed_trials_dicts) > int(os.environ["completed_trials"]):
                best_results = com_func(
                    [
                        item[args.metric]
                        for item in completed_trials_dicts[
                            int(os.environ["completed_trials"]) :
                        ]
                    ]
                )
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
                    response_tasks=response,
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
            print("## Optimization Recommendation")
            if (
                len(completed_trials_dicts) > int(os.environ["completed_trials"])
                and best_results > initial_results
            ):
                cognitive_agent.messages.pop()
                cognitive_agent.messages.pop()

            response_tasks = cognitive_agent.temp_responses(
                cognitive_prompt3.format(
                    trials=trials,
                    completed_trials=json.dumps(completed_trials_dicts),
                    keys=list(gt_trials[0]["params"].keys()),
                    n_jobs=min(args.n_jobs, len(trials)),
                    used_trial_ids=used_trial_ids,
                    response_tasks=response,
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

    else:
        for idx, chunk in enumerate(chunk_list(trials, chunk_size)):
            prompt_rel = (
                system_prompt + "\n"
                f"The following chunked database is the search space:\n{chunk} (Numbering starts from 0)\n"
                f"Here is Recommended Trials:\n{used_trial_ids}"
            )

            cognitive_agent = Agent(
                instruction=f"{prompt_rel}",
                meta=dataset,
                role="cognitive",
                cache=cache,
            )

            print(f"Querying {query} in block {idx + 1}...")
            response = cognitive_agent.temp_responses(
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

            result = parse_yaml(response)
            if isinstance(result, list):
                filtered_result = [
                    item for item in result if item["params"] is not None
                ]
                all_responses.extend(filtered_result)
                query = query - set([item["number"] for item in filtered_result])
            all_responses.append(response)

        summary_agent = Agent(
            instruction="You are a summarizer. Combine all extracted trials into a single clean list. "
            "Do not duplicate, and ensure all trials include their number and parameters clearly.",
            role="rag_moderator",
            meta=dataset,
            # model_info="gpt-4.1-mini",
        )
        combined_response = "\n\n".join(all_responses)

        # 汇总输出
        final_summary = summary_agent.temp_responses(
            f"The following are extracted trials from different blocks:\n{combined_response}\n\n"
            "Please merge them into a single final list."
        )

        return final_summary, trial_hyper_params, number, success


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

