# TTS 性能优化改动清单

日期：2026-06-16
目标：降低 GPT-SoVITS v4 TTS 合成耗时（单句约 6s → 目标 4s 出头），并优化 Socratopia 软件侧调用链路。
模型版本保持 v4（无 v2ProPlus 训练权重，不更换版本）。

---

## 一、模型服务端改动（仓库：`D:\model_tts\GPT-SoVITS-1007-cu124\GPT-SoVITS-1007-cu124`）

> 改完需**重启 gsvi 服务**生效（`gsvi.bat` / `runtime\python.exe gsvi.py`）。

### A. 启动 CUDA 预热
- 文件：`tools/my_infer.py`
- 改动：`pre_infer()` 末尾调用新增的 `_warmup_device()`，启动时跑几次 bmm + conv1d，预热 cuBLAS/cuDNN，消除首请求一次性 CUDA 上下文初始化开销。
- 注意：模型专属 kernel 仍会在第一次真实合成时编译一次，无法在无权重/无参考音频时提前预热，故第一句仍略慢。

### B+D. 调整默认推理参数
- 文件：`gsvi.py`（4 个请求模型：`otherParams` / `inferWithEmotions` / `inferWithMulti` / `inferWithClassic`）
- 改动：`batch_size` 默认 `1 → 8`；`sample_steps` 默认 `16 → 12`（曾试 8，音质偏低，回调到 12）。
- 原理：多句时 batch 摊薄 AR 与 vocoder 固定开销；sample_steps 近似线性影响 CFM 扩散耗时。
- 注意：软件侧请求未显式传这两个字段，因此自动走这里的默认值，软件无需改动即可受益。

### C. v4 vocoder 参考固定开销缓存（单句结构性优化，对课堂收益最大）
- 文件：`GPT_SoVITS/TTS_infer_pack/TTS.py`
- 改动点：
  1. `prompt_cache` 初始化新增键 `"vocoder_ref": None`（约 line 444 附近）。
  2. `set_ref_audio()` 末尾置 `self.prompt_cache["vocoder_ref"] = None`（参考音频变更时缓存失效）。
  3. `using_vocoder_synthesis_batched_infer()`（约 line 1498）：把只依赖参考音频的
     `fea_ref / ge / mel2 / T_min / chunk_len / refer_audio_spec` 缓存进 `prompt_cache["vocoder_ref"]`，
     命中则跳过 `decode_encp + resample + mel_fn`；未命中才计算并写入缓存。
- 安全性：`fea_ref.repeat(bs,1,1)` 新建张量、不改缓存原值，跨请求复用安全。
- 效果：同一参考连续合成时，第二句起省掉该段固定开销。

### E. 流式分段返回端点（备用，课堂未启用）
- 文件：`tools/my_infer.py` 新增 `tts_infer_stream()` / `single_infer_stream()`；`gsvi.py` 新增 `POST /infer_single_stream`（`StreamingResponse`）。
- 用途：开 `return_fragment` 逐句产出音频，首句先出声。
- 说明：经核查课堂前端**已在客户端做分句并行 + 首句先播**，改用该端点反而会退化为服务端单流串行，故课堂**不接入**；端点保留给未来「长文本边合成边播」新场景。

---

## 二、软件侧改动（仓库：`E:\huanjing\sogeladi\Socratopia`，Electron 打包产物）

> 改完需**重启 `Socratopia.exe`**（服务端 chunk 启动时复制到 `%APPDATA%\socratopia\server\`）。
> 文件：`resources/server/.next/server/app/api/groupchat/route.js`
> 备份：同目录 `route.js.bak`（改动前，45560 字节）。回滚：`cp route.js.bak route.js`
> 校验：已通过 `node --check` 与 acorn 解析。

### 3. 群聊并发 2 → 1
- `_ttsS` 中 `for(;_ttsRN>=2;)` 改为 `>=1`。
- 原因：服务端是单个全局 `tts_pipeline`，`run()` 会改 `prompt_cache`/`infer_panel`；并发请求会踩 prompt_cache 竞态，且单 GPU 无真并行收益。纯排队更安全。

### 2. 群聊内容寻址缓存
- 新增 `_ttsK(voiceKey, text)`：djb2 风格哈希，输出 `c<base36>` 作为缓存文件名。
- `_ttsS` 改为：入队前先 `existsSync` 快路径命中直接返回；抢到槽位后再 `existsSync` 复查（防竞态重复合成）；写盘文件名由旧的「时间戳_名字」改为内容哈希。
- 效果：重复台词（开场白/旁白等）直接命中秒返，不再因时间戳 key 永不命中而每次重合成。
- 输出 URL 形状不变：`/api/tts-audio?file=<key>.wav`。

### 1. 群聊按说话人排序派发
- 原循环「边解析边 `_ttsResults.push(_ttsS(...))`」改为：先把每行解析成 `_ttsJobs[{t,v,n}]`，
  用 `_ttsResults.push(null)` 占位，按 `voiceKey`(v) 排序得到 `_ttsOrd`，再按该序派发，结果用
  `_ttsResults[oi]=...` **按原始行索引回填**。
- 效果：同一说话人台词连续合成，最小化 `load_weights` 的磁盘权重重载次数；播放顺序（`audioFiles:_af`）保持原序不变。

### 4. 课堂流式播放
- 结论：**未改动**。课堂前端（`static/chunks/app/page-*.js` 的 `chunkText → synthesize → voicePlayer.play` 链）已实现分句逐句合成 + 首句先播，等价于流式，无需改造。课堂提速主要由模型侧 C（参考缓存）带来。

---

## 三、回滚指引

- 模型侧：`gsvi.py` / `tools/my_infer.py` / `TTS.py` 的改动均为局部新增/参数调整，可按本清单逐条还原；无备份文件（依赖版本管理或手工还原）。
- 软件侧：`cp route.js.bak route.js` 后重启 `Socratopia.exe` 即可完全回滚群聊改动。

## 四、建议的运行时验证

1. 群聊重复台词第二次是否秒出（缓存命中）。
2. 多人对话整体是否变快（说话人排序 + 并发降为 1）。
3. 课堂同一伙伴多句，第二句起 t_45 是否下降（C 参考缓存生效）。
4. 确认 sample_steps=12 音质可接受。

---

## 2026-06-17 Group chat TTS order adjustment
- Changed group-chat TTS dispatch back to original message order.
- Kept content-addressed TTS cache (`_ttsK(voiceKey, text)`) and single-flight TTS queue (`_ttsRN >= 1`).
- Removed the effective `voiceKey` sorting dispatch so one character is no longer synthesized all the way through before later characters.
- `lines_final` remains unchanged: `audioFiles[i]` still corresponds to `lines[i]`.

## 2026-07-02 Group chat sentence-return TTS
- `/api/groupchat` now emits `lines_final` before waiting for TTS, so the UI can show generated messages as soon as the text is ready.
- Group-chat TTS then runs in original line order and emits one `tts_audio` SSE event per completed line, followed by `tts_done`.
- The page bundle and server page bundle now display `lines_final` immediately and skip the later duplicate display when the stream finishes.
