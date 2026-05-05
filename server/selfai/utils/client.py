import sys
import os

sys.path.append(os.path.dirname(__file__))

import datetime
import httpx
import openai
import anthropic
import logging
import time
import base64
import io
import json
import copy
import shutil

from openai import OpenAI
from functools import wraps
import numpy as np
from typing import Literal
from filelock import FileLock
from logging_utils import print_log, create_logger
import ollama
from ollama import ChatResponse, chat
from PIL import Image


base_logger = logging.getLogger(os.path.basename(__file__))
STREAM_LOG_FILE_ENV = "SELF_AI_STREAM_LOG_FILE"


def _stream_print(*values, sep=" ", end="\n", flush=True):
    text = sep.join(str(v) for v in values)
    print(text, end=end, flush=flush)

    log_path = os.environ.get(STREAM_LOG_FILE_ENV, "").strip()
    if not log_path:
        return
    try:
        with open(log_path, "a", encoding="utf-8") as fp:
            fp.write(text + end)
            fp.flush()
    except Exception:
        # Never break model streaming because of log append failures.
        return


def _load_json_with_fallback(path: str):
    # 先 utf-8，再 gbk；若 gbk 成功则回写 utf-8 规范化
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), "utf-8"
    except UnicodeDecodeError:
        with open(path, "r", encoding="gbk") as f:
            data = json.load(f)
        # 回写成 utf-8
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        return data, "gbk"


def _filter_saved_messages(
    saved_messages: dict, fname: str, cached_action_keys, cached_mode: str
):
    """
    输入结构假设：saved_messages = {fname: {action: value, ...}}
    输出同结构
    """
    if "all" in cached_action_keys or cached_mode == "all":
        saved_messages[fname].pop("decision-Moderator", None)
        return saved_messages

    src = saved_messages.get(fname, {})
    dst = {}

    # 你的特殊逻辑：如果 cached_action_keys 里包含 initial_assessment-，
    # 就额外允许 recruit-recruiter / examplers- / initial_assessment-
    if any(k.startswith("initial_assessment-") for k in cached_action_keys):
        allow_prefixes = ("initial_assessment-", "recruit-recruiter", "examplers-")
        for action, value in src.items():
            if action.startswith(allow_prefixes) or any(
                action == k for k in cached_action_keys
            ):
                dst[action] = value
    else:
        # 普通白名单
        allow_set = set(cached_action_keys)
        dst = {action: value for action, value in src.items() if action in allow_set}

    # ✅ 修正：decision-Moderator 应该从 action 层删除
    dst.pop("decision-Moderator", None)

    return {fname: dst}


class CachedBase:

    def init(self, saved_fname):
        self.work_dir = os.environ["work_dir"]
        self.cache_path = os.environ["cache_path"]
        self.cached_mode = os.environ["cached_mode"]  # 'skip', 'all', 'none'
        self.cached_action_keys = os.getenv("cached_action_keys", "").split(",")
        self.saved_fname = str(saved_fname)
        self.saved_as_path = os.environ["saved_as_path"]
        self.saved_messages_new = {self.saved_fname: {}}

        if not hasattr(self, "saved_messages") and self.cached_mode != "skip":
            cache_dir = os.path.join(self.work_dir, self.cache_path)
            os.makedirs(cache_dir, exist_ok=True)

            file_path = os.path.join(cache_dir, f"{self.saved_fname}.json")
            lock_path = os.path.join(cache_dir, f"{self.saved_fname}.lock")

            with FileLock(lock_path):
                if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
                    saved_messages, _enc = _load_json_with_fallback(file_path)

                    # 按规则过滤
                    self.saved_messages = _filter_saved_messages(
                        saved_messages,
                        self.saved_fname,
                        self.cached_action_keys,
                        self.cached_mode,
                    )
                else:
                    # 不存在或空文件：初始化并落盘（可选）
                    self.saved_messages = {self.saved_fname: {}}
                    with open(file_path, "w", encoding="utf-8") as f:
                        json.dump(self.saved_messages, f, ensure_ascii=False, indent=4)

            actions = list(self.saved_messages[self.saved_fname].keys())

            for action in actions:
                if (
                    "initial_assessment-stage2-stage1" in action
                    or "initial_assessment-stage2-stage2" in action
                ):

                    parts = action.split("-")
                    # 删除第二段（stage2）
                    new_action = "-".join([parts[0]] + parts[2:])

                    self.saved_messages[self.saved_fname][new_action] = (
                        self.saved_messages[self.saved_fname][action]
                    )

                    del self.saved_messages[self.saved_fname][action]
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(self.saved_messages, f, ensure_ascii=False, indent=4)

    def load_saved_messages(self, action, role, use_cached):

        action = f"{action}-{role}"

        if "gap_recruited_assessment" in action:
            return self.saved_messages.get(
                action.replace("gap_recruited_assessment", "initial_assessment-"), None
            )

        if self.cached_mode != "skip":
            if action in self.saved_messages[self.saved_fname].keys() and (
                self.cached_mode == "all" or use_cached
            ):
                return self.saved_messages[self.saved_fname][action]
            else:
                if not (self.cached_mode == "all" or use_cached):
                    print(
                        f"For {action} use cached results is forbidden. We will update local cache."
                    )
                else:
                    print(f"{action} isn't saved. We will update local cache.")

        return None

    def do_save_messages(self, action, saved_messages, role, use_cached):
        action = f"{action}-{role}" if role != "" else f"{action}"

        if action in self.saved_messages[self.saved_fname].keys():
            self.saved_messages_new[self.saved_fname][action] = saved_messages
            self.saveas_json()
        else:
            self.saved_messages[self.saved_fname][action] = saved_messages
            self.saveas_json()

            # shutil.move(
            #     f"{self.work_dir}/{self.cache_path}/{self.saved_fname}.json",
            #     f"{self.work_dir}/{self.cache_path}/{self.saved_fname}_1.json",
            # )

    def saveas_json(self):
        with FileLock(f"{self.work_dir}/{self.cache_path}/{self.saved_fname}.lock"):
            with open(
                f"{self.work_dir}/{self.cache_path}/{self.saved_fname}.json",
                "w",
                encoding="utf-8",
            ) as f:
                json.dump(
                    (
                        self.saved_messages
                        if self.saved_as_path == self.cache_path
                        else self.saved_messages_new
                    ),
                    f,
                    ensure_ascii=False,
                    indent=4,
                )

    def save_round_comment(self, action, comment, role, use_cached):
        num_agents = len(comment)
        comment = [f"{k}:{v}" for k, v in comment.items()]
        comment = "|".join(comment)
        self.saved_messages[self.saved_fname][f"{action}-role-comment"] = comment
        self.saved_messages[self.saved_fname][f"{action}-num_agents"] = num_agents
        with FileLock(f"{self.work_dir}/{self.cache_path}/{self.saved_fname}.lock"):
            with open(
                f"{self.work_dir}/{self.cache_path}/{self.saved_fname}.json",
                "w",
                encoding="utf-8",
            ) as f:
                json.dump(
                    self.saved_messages,
                    f,
                    ensure_ascii=False,
                    indent=4,
                )


def encode_image_to_base64(pil_image):
    buffered = io.BytesIO()
    pil_image.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def time_it(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()  # 记录开始时间
        result = func(*args, **kwargs)  # 调用原函数
        end_time = time.time()  # 记录结束时间
        duration = end_time - start_time  # 计算持续时间
        base_logger.info(
            f"Function '{func.__name__}' took {duration:.4f} seconds to execute."
        )
        return result

    return wrapper


def retry_on_api_error(func):
    max_retries = os.environ.get("max_retries", 5)
    retry_delay = os.environ.get("retry_delay", 1)

    @wraps(func)
    def wrapper(*args, **kwargs):
        for attempt in range(max_retries):
            try:
                response = func(*args, **kwargs)  # 调用被装饰的函数
                if response is None:
                    continue
                else:
                    return response
            except openai.APIError as e:
                print(f"Attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:  # 如果不是最后一次尝试
                    time.sleep(retry_delay)
                else:
                    print(
                        "All attempts failed. Please check the API status or your request."
                    )
                    return "nan"
            except TimeoutError as e:
                print(f"retrying {attempt}")
                continue
            except KeyboardInterrupt as e:
                raise KeyboardInterrupt
        return "nan"

    return wrapper


def get_openai_client(api_key, base_url=None):
    return openai.OpenAI(api_key=api_key, base_url=base_url)


def get_claude_client(api_key):
    return anthropic.Anthropic(api_key=api_key)


def get_deepseek_client(api_key, base_url="https://api.deepseek.com"):
    return openai.OpenAI(api_key=api_key, base_url=base_url)


def get_gemini_client(
    api_key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
):
    return openai.OpenAI(api_key=api_key, base_url=base_url)


def get_ollama_client(base_url="http://localhost:11434/v1/"):
    return openai.OpenAI(base_url=base_url)


def get_vllm_client(base_url="http://localhost:8000/v1/"):
    return openai.OpenAI(base_url=base_url)


class Agent_ollama_python:

    def __init__(
        self,
        instruction,
        role,
        meta="",
        rag=None,
        model_info=None,
        source=None,
        examplers=None,
        logger=None,
        use_cached=False,
        cache=None,
    ):
        self.instruction = instruction
        self.role = role
        self.model_info = (
            model_info if model_info is not None else os.environ["MODEL_INFO"]
        ).replace("_", ":")
        # self.source = source if source is not None else os.environ["SOURCE"]
        self.logger = logger
        self.content = ""
        self.rag = rag
        self.work_dir = os.environ["work_dir"]
        self.use_cached = use_cached

        self.messages = [
            {"role": "system", "content": json.dumps(self.instruction)},
        ]

        # ollama.show(model_info)

    @time_it
    @retry_on_api_error
    def temp_responses(
        self, message, action, imgs=None, rag=None, timeout=300, debug=False
    ):

        if self.model_info == "gemini-pro":
            response = self._chat.send_message(message, stream=True)
            responses = ""
            for chunk in response:
                responses += chunk.text + "\n"
            return responses
        else:
            self.messages.append({"role": "user", "content": json.dumps(message)})
            _stream_print("question: \n", self.messages[1]["content"])
            temperatures = [0.0]

            responses = {}
            for temperature in temperatures:
                if "gpt" in self.model_info:
                    if self.model_info == "gpt-3.5":
                        model_info = "gpt-3.5-turbo"
                    else:
                        model_info = "gpt-4o-mini"
                else:
                    model_info = self.model_info

                response = chat(
                    model=model_info,
                    messages=self.messages,
                    options={"temperature": temperature},
                    stream=True,
                )
            _stream_print("response: \n")
            content = ""
            for chunk in response:
                # print(chunk.choices[0].delta.content, end="")
                # delta_content = chunk.choices[0].delta.content
                _stream_print(chunk["message"]["content"], end="")
                delta_content = chunk["message"]["content"]
                if delta_content is not None:
                    content += delta_content
            _stream_print()
            print_log(content, logger=self.logger)
            responses[temperature] = content  # response.choices[0].message.content

            return responses[0.0]


class Agent:
    def __init__(
        self,
        instruction,
        role,
        meta,
        rag=False,
        examplers=None,
        model_info=None,
        img_path=None,
        logger=None,
        cache=None,
        source=None,  # ✅ 新增：允许外部指定 source（openai/ollama/vllm/claude/gemini/deepseek）
    ):
        self.instruction = instruction
        self.role = role
        self.meta = meta
        self.img_path = img_path
        self.logger = logger
        self.cache = cache
        self.rag = rag

        # ✅ 统一确定 model_info
        self.model_info = self._resolve_model_info(model_info)

        # ✅ 统一确定 source（优先按 model_info 推断，其次用显式 source）
        self.source = self._resolve_source(source, self.model_info)

        # ✅ 初始化 client
        self.client, self._chat = self._init_client(
            self.source, self.model_info, rag=self.rag
        )

        # ✅ 初始化 messages（system）
        self.messages = self._init_messages(self.instruction, self.model_info)

        # ✅ vision client 固定用 OpenAI
        from openai import OpenAI

        self.vis_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

        # 你代码里用到这些字段，但片段没给，我这里保留引用点
        # self.vision_prompt / self.vision_prompt_part 需要你自己在外部或子类里设置
        # self.vision_prompt = ...
        # self.vision_prompt_part = ...

    # -----------------------
    # init helpers
    # -----------------------
    def _resolve_model_info(self, model_info):
        if model_info is not None:
            return model_info

        env = os.environ.get("MODEL_INFO")
        if not env:
            raise ValueError("MODEL_INFO is not set and model_info is None.")

        # 支持 "a,b,c" 随机选一个
        parts = [p.strip() for p in env.split(",") if p.strip()]
        if len(parts) == 1:
            return parts[0]
        return str(np.random.choice(parts, size=1, replace=True)[0])

    def _resolve_source(self, source, model_info: str):
        if source:
            return source

        mi = (model_info or "").lower()
        if mi == "gemini-pro":
            return "gemini"
        if "claude" in mi:
            return "claude"
        if "deepseek" in mi and "deepseek-r1" not in mi:
            return "deepseek"
        if "gpt" in mi:
            return "openai"
        # 默认 fallback
        return "ollama"

    def _init_client(self, source: str, model_info: str, rag: bool):
        source = source.lower()
        model_info = model_info

        if source == "gemini":
            import google.generativeai as genai

            model = genai.GenerativeModel("gemini-pro")
            chat = model.start_chat(history=[])
            return model, chat

        if source == "claude":
            import anthropic

            client = anthropic.Anthropic(api_key=os.environ.get("CLAUDE_API_KEY"))
            return client, None

        if source == "deepseek":
            from openai import OpenAI

            client = OpenAI(
                api_key=os.environ.get("DEEPSEEK_API_KEY"),
                base_url="https://api.deepseek.com",
            )
            return client, None

        if source == "openai":
            if rag:
                from langchain_community.chat_models import ChatOpenAI
                from langchain.callbacks.streaming_stdout import (
                    StreamingStdOutCallbackHandler,
                )

                handler = StreamingStdOutCallbackHandler()
                client = ChatOpenAI(
                    model_name=model_info,
                    temperature=0.7,
                    streaming=True,
                    callbacks=[handler],
                )
                return client, None
            else:
                from openai import OpenAI

                client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
                return client, None

        if source == "ollama":
            if rag:
                from langchain_community.llms import Ollama
                from langchain.callbacks.streaming_stdout import (
                    StreamingStdOutCallbackHandler,
                )

                handler = StreamingStdOutCallbackHandler()
                client = Ollama(model=model_info, streaming=True, callbacks=[handler])
                return client, None
            else:
                import ollama

                return ollama, None

        if source == "vllm":
            from openai import OpenAI

            client = OpenAI(api_key="EMPTY", base_url="http://localhost:8000/v1/")
            return client, None

        raise ValueError(f"Unknown source={source}, model_info={model_info}")

    def _init_messages(self, instruction, model_info: str):
        if instruction is None:
            return []

        # deepseek 的 system 你原本做了特殊处理（json dumps）
        return [{"role": "system", "content": json.dumps(instruction)}]

    # -----------------------
    # public helpers
    # -----------------------
    def reset(self):
        # 保留 system prompt
        if self.messages and self.messages[0]["role"] == "system":
            self.messages = self.messages[:1]
        else:
            self.messages = []

    def set_limited_access(self, prompt): ...

    # -----------------------
    # image helpers
    # -----------------------
    def _to_base64_image(self, img):
        # 你原来用 encode_image_to_base64，这里仍然调用外部函数
        # 假设 encode_image_to_base64(pil_image) -> base64 str
        if isinstance(img, str):
            return img

        if isinstance(img, np.ndarray):
            arr = img
            if arr.dtype != np.uint8:
                m = float(arr.max()) if float(arr.max()) != 0 else 1.0
                arr = (arr / m * 255.0).astype(np.uint8)
            pil_image = Image.fromarray(arr)
        else:
            pil_image = img

        return encode_image_to_base64(pil_image)

    def _build_vision_user_message(self, text: str, imgs):
        """
        返回 OpenAI/DeepSeek 风格或 Claude 风格的 user message（只负责把图像塞进去）
        """
        is_claude = "claude" in (self.model_info or "").lower()

        content = [{"type": "text", "text": f"{text}"}]

        if isinstance(imgs, dict):
            items = imgs.items()
        else:
            items = [("image", imgs)]

        for name, img in items:
            image_base64 = self._to_base64_image(img)

            if is_claude:
                content.extend(
                    [
                        {
                            "type": "text",
                            "text": f"The following image {name} is provided: ",
                        },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": image_base64,
                            },
                        },
                    ]
                )
            else:
                content.extend(
                    [
                        {
                            "type": "text",
                            "text": f"The following image {name} is provided: ",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            },
                        },
                    ]
                )

        return {"role": "user", "content": content}

    # -----------------------
    # streaming helpers
    # -----------------------
    def _stream_openai(self, client, model, messages, temperature, timeout=None):
        # OpenAI SDK (Responses/ChatCompletions) 你用的是 chat.completions.create
        import openai

        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=(temperature if temperature != "default" else openai.NotGiven),
            stream=True,
            timeout=timeout,
        )
        content = ""
        for chunk in resp:
            delta = chunk.choices[0].delta.content
            if delta is not None:
                _stream_print(delta, end="")
                content += delta
        _stream_print()
        return content

    def _stream_ollama(self, model, messages, temperature):
        resp = chat(
            model=model,
            messages=messages,
            options=(
                {"temperature": temperature} if temperature != "default" else None
            ),
            stream=True,
        )
        content = ""
        for chunk in resp:
            delta = chunk["message"]["content"]
            if delta is not None:
                _stream_print(delta, end="")
                content += delta
        _stream_print()
        return content

    def _stream_claude(self, client, model, system_prompt, user_messages, temperature):
        import anthropic

        with client.messages.stream(
            system=system_prompt,
            max_tokens=256,
            messages=user_messages,
            model=model,
            temperature=(
                temperature if temperature != "default" else anthropic.NotGiven
            ),
        ) as stream:
            content = ""
            for text in stream.text_stream:
                if text is not None:
                    _stream_print(text, end="")
                    content += text
        _stream_print()
        return content

    def _stream_deepseek(self, client, model, messages, temperature):
        # deepseek 会返回 reasoning_content / content
        import openai

        reasoning_content = "<think> "
        content = ""

        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            temperature=(temperature if temperature != "default" else openai.NotGiven),
            timeout=httpx.Timeout(10.0, read=20.0),
        )

        _stream_print("<think> ", end="")
        for chunk in resp:
            delta_reason = getattr(chunk.choices[0].delta, "reasoning_content", None)
            if delta_reason is not None:
                _stream_print(delta_reason, end="")
                reasoning_content += delta_reason

            delta = chunk.choices[0].delta.content
            if delta is not None:
                _stream_print(delta, end="")
                content += delta

        _stream_print()
        if "answer:" not in content.lower():
            content = "Answer:" + content

        return reasoning_content, content

    # -----------------------
    # main
    # -----------------------

    def chat(
        self,
        message,
        action,
        imgs=None,
        use_cached=False,
        temperatures=(0.0,),
        debug=False,
        timeout=300,
    ):

        return self.temp_responses(
            message,
            action,
            imgs=imgs,
            use_cached=use_cached,
            temperatures=temperatures,
            debug=debug,
            timeout=timeout,
        )

    def temp_responses(
        self,
        message,
        action,
        imgs=None,
        use_cached=False,
        temperatures=(0.0,),
        debug=False,
        timeout=300,
    ):
        # 1) cache hit: 直接返回
        if self.cache is not None:
            cached_content = self.cache.load_saved_messages(
                action, self.role, use_cached
            )
            if cached_content is not None:
                self.messages.append({"role": "assistant", "content": cached_content})
                _stream_print(cached_content)
                return cached_content

        # 2) append user message
        if imgs is None:
            if isinstance(message, list):
                self.messages.extend(message)
            else:
                self.messages.append({"role": "user", "content": message})
        else:
            self.messages.append(self._build_vision_user_message(message, imgs))

        # 3) gemini 单独处理
        if self.source == "gemini":
            return self._call_gemini(message)

        # 4) vision flow（你原来两阶段，这里尽量保持结构，但减少重复）
        if imgs is not None:
            content = self._run_vision_pipeline(action, use_cached)
            return content

        # 5) normal text generation (multi temperature)
        responses = {}
        reasoning_content = None
        last_content = None

        for temperature in temperatures:
            _stream_print("#####")
            _stream_print(
                f"## {self.role} ({self.meta} - {self.model_info}): ",
                end="",
                flush=True,
            )

            if self.source == "claude":
                system_prompt = self.messages[0]["content"] if self.messages else ""
                user_prompt = self.messages[1:] if self.messages else []
                content = self._stream_claude(
                    self.client,
                    self.model_info,
                    system_prompt,
                    user_prompt,
                    temperature,
                )
                self.messages.append({"role": "assistant", "content": content})
                responses[temperature] = content
                last_content = content

            elif self.source == "openai":
                content = self._stream_openai(
                    self.client,
                    self.model_info,
                    self.messages,
                    temperature,
                    timeout=timeout,
                )
                self.messages.append({"role": "assistant", "content": content})
                responses[temperature] = content
                last_content = content

            elif self.source == "ollama":
                content = self._stream_ollama(
                    self.model_info, self.messages, temperature
                )
                self.messages.append({"role": "assistant", "content": content})
                responses[temperature] = content
                last_content = content

            elif self.source == "deepseek":
                # ✅ 修复你原本的字符串拼接问题
                prompt = self.messages.pop()["content"]
                think_payload = (
                    f"<think>\n\n{prompt}\n\n{self.messages[0]['content']}\n</think>"
                )
                self.messages.append({"role": "user", "content": think_payload})

                reasoning_content, content = self._stream_deepseek(
                    self.client, self.model_info, self.messages, temperature
                )
                self.messages.append({"role": "assistant", "content": content})
                responses[temperature] = content
                last_content = content

            else:
                raise ValueError(f"Unsupported source: {self.source}")

        # 6) save cache（按你原逻辑：deepseek 保存 think + content）
        if self.cache is not None and last_content is not None:
            if (
                self.source == "deepseek"
                and "deepseek-r1" not in (self.model_info or "").lower()
            ):
                if reasoning_content is not None:
                    self.cache.do_save_messages(
                        f"think-{action}", reasoning_content, self.role, use_cached
                    )
                self.cache.do_save_messages(action, last_content, self.role, use_cached)
            else:
                self.cache.do_save_messages(action, last_content, self.role, use_cached)

        # ✅ 不再强行 responses[0.0]，而是返回第一个 temperature 对应的结果
        first_temp = next(iter(temperatures)) if temperatures else 0.0
        return responses.get(first_temp, last_content)

    # -----------------------
    # extracted: gemini + vision
    # -----------------------
    def _call_gemini(self, message: str):
        # 保留你原来 retry 行为
        for _ in range(10):
            try:
                response = self._chat.send_message(message, stream=True)
                text = ""
                for chunk in response:
                    text += chunk.text + "\n"
                return text
            except Exception:
                continue
        return "Error: Failed to get response from Gemini."

    def _run_vision_pipeline(self, action, use_cached: bool):
        """
        你原来的 stage1 + stage2 视觉分析流程：
        - stage1: 用 gpt-4.1-mini 对图像做分析（生成 content）
        - stage2: 用 vision_prompt_part + 原始文本再问一次（生成最终 content）
        """
        if self.cache is None:
            cached_stage1 = None
            cached_stage2 = None
        else:
            cached_stage1 = self.cache.load_saved_messages(
                f"{action}-stage1", self.role, use_cached
            )
            cached_stage2 = self.cache.load_saved_messages(
                f"{action}-stage2", self.role, use_cached
            )

        # stage1
        if cached_stage1 is None:
            msg = copy.deepcopy(self.messages)
            # 这里假设 messages[1] 是含图片的 user message，并且第一个 content 是 text
            # 你原来写的是 msg[1]["content"][0]["text"] = self.vision_prompt
            if (
                len(msg) > 1
                and isinstance(msg[1].get("content"), list)
                and msg[1]["content"]
            ):
                msg[1]["content"][0]["text"] = self.vision_prompt

            _stream_print(
                f"## {self.role} ( {self.meta} - image analyzed by gpt-4.1-mini): ",
                end="",
                flush=True,
            )
            stage1 = self._stream_openai(
                self.vis_client, "gpt-4.1-mini", msg, temperature=0.0, timeout=300
            )
            if self.cache is not None:
                self.cache.do_save_messages(
                    f"{action}-stage1", stage1, self.role, use_cached
                )
        else:
            stage1 = cached_stage1

        # stage2
        if cached_stage2 is None:
            # 把系统/上下文替换为 vision_prompt，再加 stage1，再追加 vision_prompt_part + 原文本
            original_text = ""
            if (
                len(self.messages) > 1
                and isinstance(self.messages[1].get("content"), list)
                and self.messages[1]["content"]
            ):
                original_text = self.messages[1]["content"][0].get("text", "")

            # 替换为 vision_prompt（你原来直接 self.messages[1]["content"] = self.vision_prompt）
            # 这里保持你意图：把“图像消息”里的首段文本替换为 vision_prompt
            self.messages[1]["content"][0]["text"] = self.vision_prompt

            self.messages.append({"role": "assistant", "content": stage1})
            self.messages.append(
                {
                    "role": "user",
                    "content": self.vision_prompt_part + "\n" + original_text,
                }
            )

            _stream_print(
                f"## {self.role} ( {self.meta} - image analyzed by gpt-4.1-mini): ",
                end="",
                flush=True,
            )
            stage2 = self._stream_openai(
                self.vis_client,
                "gpt-4.1-mini",
                self.messages,
                temperature=0.0,
                timeout=300,
            )

            if self.cache is not None:
                self.cache.do_save_messages(
                    f"{action}-stage2", stage2, self.role, use_cached
                )
        else:
            stage2 = cached_stage2

        return stage2


def test_ollama():
    model_name = "deepseek-r1:32b"
    os.environ["MODEL_INFO"] = model_name
    os.environ["SOURCE"] = "ollama"
    train_json_path = f"/home/yutong.xie/xiaowu/datasets/completion/CV/deepseek-r1:32b/siren_cameraman_TV_train_deepseek-r1_32b.json"
    logger = create_logger(experimental_desc="test", work_dir="./")
    agent = Agent(instruction="", role="user", logger=logger)
    print(agent.chat("Hello, how are you?"))
    print(agent.temp_responses("Hello, how are you?"))


def test_agent():
    model_name = "gpt-4o-mini"
    os.environ["MODEL_INFO"] = model_name
    os.environ["SOURCE"] = "ollama"
    train_json_path = f"/home/yutong.xie/xiaowu/datasets/completion/CV/deepseek-r1:32b/siren_cameraman_TV_train_deepseek-r1_32b.json"
    logger = create_logger(experimental_desc="test", work_dir="./")
    # agent_ollama = Agent_ollama(instruction="", role="user", logger=logger)
    agent = Agent(
        instruction="You are a helpful assistant",
        role="user",
        logger=logger,
    )
    print(agent.chat("Hello, how are you?"))
    print(agent.temp_responses("Hello, how are you?"))


if __name__ == "__main__":
    test_agent()
