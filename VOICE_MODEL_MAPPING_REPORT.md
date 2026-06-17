# Socratopia 伙伴语音模型选择路径报告

生成日期：2026-06-05

## 结论摘要

当前语音系统不是一个统一配置表驱动，而是分散在前端页面 chunk、前端语音库 chunk、服务端语音库 chunk、群聊 API 路由中。

最重要的差异是：

- 课堂流程：前端根据 `candidateId`、`worldLanguage`、`companionVoices` 选择 `voiceKey`，再调用前端语音库合成并直接播放。
- 群聊流程：服务端 `/api/groupchat` 路由根据最终发言文本中的“发言人名字”反查世界数据里的伙伴，再选择 `voiceKey`，调用本地 `http://127.0.0.1:8000/infer_classic`，并把音频写入 `tts-cache`。
- 课堂默认映射和群聊默认映射不一致。尤其课堂默认表仍包含一些旧 voice key，例如 `zh_reliable_executive`、`zh_stubborn_friend`、`gentleman`，但当前 GPT-SoVITS 表主要是 10 个新中文女声 key。

## 关键文件

| 文件 | 作用 |
|---|---|
| `E:\huanjing\sogeladi\Socratopia\resources\server\.next\static\chunks\4137-131d0676e3b5bef7.js` | 前端运行时语音库。包含截图下拉框的语音列表、`voiceKey -> GPT-SoVITS 模型` 表、前端 `synthesize/speak`。 |
| `E:\huanjing\sogeladi\Socratopia\resources\server\.next\server\chunks\3461.js` | 服务端等价语音库 chunk。内容与 `4137` 基本重复，用于 SSR/服务端引用场景。 |
| `E:\huanjing\sogeladi\Socratopia\resources\server\.next\static\chunks\app\page-3a1fef7566e26c43.js` | 主前端页面。包含伙伴管理界面的 VoicePicker、课堂内 `candidateId -> 默认 voiceKey` 映射。 |
| `E:\huanjing\sogeladi\Socratopia\resources\server\.next\server\app\page.js` | 主页面服务端等价 bundle，包含与前端页面相近的逻辑。 |
| `E:\huanjing\sogeladi\Socratopia\resources\server\.next\server\app\api\groupchat\route.js` | 群聊 API。包含群聊 TTS 的 `_ttsV` 模型表和 `_cidToVk` 默认伙伴语音映射。 |

## 当前语音库：voiceKey -> 显示名 -> GPT-SoVITS 模型

这张表来自 `4137-131d0676e3b5bef7.js` 和 `3461.js` 中的 `BUNDLED_SNAPSHOT` 与 `synthesize` 模型表。群聊接口的 `_ttsV` 也重复了一份近似相同的模型表。

| voiceKey | 下拉框显示名 | GPT 模型 `g` | SoVITS 模型 `s` |
|---|---|---|---|
| `soft_girl` | 芙宁娜 | `【经典】Funina-e15` | `【经典】Funina_e8_s464` |
| `warmhearted_girl` | 爱莉希雅 | `【经典】爱莉希雅-e10` | `【经典】爱莉希雅_e10_s220` |
| `intellectual_girl` | 布洛妮娅 | `【经典】布洛妮娅-e10` | `【经典】布洛妮娅_e10_s920` |
| `laidback_girl` | 花火 | `【经典】花火-e10` | `【经典】花火_e10_s140` |
| `mature_woman` | 姬子 | `【经典】姬子-e10` | `【经典】姬子_e10_s470` |
| `explorative_girl` | 芙卡洛斯 | `【经典】芙卡洛斯-e10` | `【经典】芙卡洛斯_e10_s60` |
| `bashful_girl` | 小格蕾修 | `【经典】格雷修_绘星之卷-e10` | `【经典】格雷修_绘星之卷_e10_s130` |
| `crisp_girl` | 次生银翼 | `【经典】布洛妮娅_次生银翼-e10` | `【经典】布洛妮娅_次生银翼_e10_s260` |
| `zh_wise_woman` | 大黑塔 | `【经典】大黑塔-e10` | `【经典】大黑塔_e8_s800` |
| `sweet_lady` | 大格蕾修 | `【经典】格蕾修-e10` | `【经典】格蕾修_e10_s130` |

前端语音库里 `VOICE_GROUPS` 当前是：

```js
["[已修改]中文女声", "[已修改]中文男声"]
```

但实际 `BUNDLED_SNAPSHOT` 里目前看到的生产可用条目主要是上表 10 个中文女声。

## 课堂流程内如何选择语音模型

课堂流程主要发生在 `page-3a1fef7566e26c43.js`。

### 1. 伙伴管理界面的下拉框

截图里的下拉框对应前端组件函数 `aO(...)`，它做的事情是：

1. 当前值取 `value`，如果没有值则用 `el.DEFAULT_VOICE_KEY`。
2. 调用 `el.getVoice(x)` 找到当前语音条目。
3. 如果传入了 `gender` 和 `language`，调用 `el.filterVoices(gender, language)` 过滤语音。
4. 如果是 `zh + female`，会额外确保 10 个中文女声 key 都进入候选列表。
5. 用户选择后，调用 `onChange(voiceKey)`，保存到当前伙伴配置中。

### 2. 课堂内默认 voiceKey 选择函数

课堂内有一个默认选择函数，反编译后逻辑约等于：

```js
function tb(e) {
  const lang = tf(e.worldLanguage); // english -> en, otherwise zh

  const exact = e.companionVoices?.[`${e.candidateId}:${lang}`];
  if (exact) return exact;

  const legacy = e.companionVoices?.[e.candidateId];
  if (legacy) {
    const voice = getVoice(legacy);
    if (voice?.language === lang) return legacy;
  }

  const mapped = th[e.candidateId]?.[lang] ?? null;
  return mapped || defaultVoiceFor(e.gender, lang);
}
```

优先级是：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | `companionVoices["candidateId:lang"]` | 当前语言精确保存值，最高优先级。 |
| 2 | `companionVoices[candidateId]` | 旧格式保存值，只有语音语言匹配时才使用。 |
| 3 | `th[candidateId][lang]` | 编译进页面 bundle 的默认伙伴映射。 |
| 4 | `defaultVoiceFor(gender, lang)` | 从当前语音库按性别/语言选分数最高的 production voice。 |

### 3. 课堂默认伙伴映射表 `th`

当前课堂默认表里的中文映射如下：

| candidateId | 伙伴名 | 课堂默认 zh voiceKey | 对应当前显示名 | 备注 |
|---|---|---|---|---|
| `qiu_lingni` | 邱灵霓 | `warmhearted_girl` | 爱莉希雅 | 当前语音库存在。 |
| `lu_yumeng` | 鹿语萌 | `intellectual_girl` | 布洛妮娅 | 当前语音库存在。 |
| `wen_ying` | 闻莺 | `laidback_girl` | 花火 | 当前语音库存在。 |
| `tao_li` | 陶砺 | `zh_reliable_executive` | 未在当前 10 个中文 voiceKey 中发现 | 疑似旧映射。 |
| `huo_yunlai` | 霍云来 | `zh_stubborn_friend` | 未在当前 10 个中文 voiceKey 中发现 | 疑似旧映射。 |
| `meng_xu` | 孟煦 | `gentleman` | 未在当前 10 个中文 voiceKey 中发现 | 疑似旧映射。 |
| `sun_wukong` | 孙悟空 | `zh_humorous_elder` | 未在当前 10 个中文 voiceKey 中发现 | 疑似旧映射。 |
| `holmes` | 福尔摩斯 | `zh_reliable_executive` | 未在当前 10 个中文 voiceKey 中发现 | 疑似旧映射。 |
| `alice` | 爱丽丝 | `soft_girl` | 芙宁娜 | 当前语音库存在。 |

注意：如果 `th` 返回了一个当前语音库不存在的 key，后续前端 `synthesize` 的模型表里会找不到对应项，最终会落到 `M[t] || M.soft_girl`，也就是默认用 `soft_girl / 芙宁娜`。

## 群聊语音功能如何选择语音模型

群聊流程在 `groupchat/route.js` 内，是服务端 route 处理。

### 1. 群聊先生成最终文本行

群聊路由先通过 LLM 生成多行消息，然后筛选出形如：

```text
[时间] 发言人：内容
```

的行。筛选完成后会发送 `lines_final`，同时尝试为每一行生成音频。

### 2. 群聊读取世界数据中的伙伴列表

群聊 TTS 初始化时会读取世界数据：

```js
_wData = await I0(profileId, worldId)
```

然后遍历：

```js
_wData.companions
```

为每个伙伴建立名字到 voiceKey 的表：

```js
_nameToVk[_c.customName || _c.name] =
  _c.voiceKey ||
  _c.voice ||
  _cidToVk[_c.candidateId] ||
  hashFallback
```

优先级是：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | `_c.voiceKey` | 伙伴管理界面保存过的语音 key。 |
| 2 | `_c.voice` | 兼容旧字段。 |
| 3 | `_cidToVk[_c.candidateId]` | 群聊路由内写死的默认映射。 |
| 4 | `_vkList[hash(candidateId) % length]` | 兜底 hash 选择。 |

### 3. 群聊按发言人名字反查 voiceKey

对每条最终群聊行：

```js
_m = line.match(/^\[([^\]]+)\]\s*([^:：]+)[:：]\s*(.+)$/)
_nm = _m[2].trim()
_txt = _m[3].trim()
_vk = _nameToVk[_nm] || _nameToVk[_slotNames[_nm]] || "soft_girl"
```

也就是说群聊不是直接按 `candidateId` 给每句配音，而是按“LLM 输出行里的发言人名字”查 `_nameToVk`。

如果 LLM 输出的名字和 `_wData.companions` 中的 `customName || name` 对不上，就会落到 `soft_girl`。

### 4. 群聊默认伙伴映射 `_cidToVk`

当前群聊默认映射如下：

| candidateId | 伙伴名 | 群聊默认 voiceKey | 对应当前显示名 |
|---|---|---|---|
| `qiu_lingni` | 邱灵霓 | `crisp_girl` | 次生银翼 |
| `alice` | 爱丽丝 | `explorative_girl` | 芙卡洛斯 |
| `holmes` | 福尔摩斯 | `intellectual_girl` | 布洛妮娅 |
| `huo_yunlai` | 霍云来 | `warmhearted_girl` | 爱莉希雅 |
| `lu_yumeng` | 鹿语萌 | `sweet_lady` | 大格蕾修 |
| `meng_xu` | 孟煦 | `zh_wise_woman` | 大黑塔 |
| `sun_wukong` | 孙悟空 | `mature_woman` | 姬子 |
| `tao_li` | 陶砺 | `laidback_girl` | 花火 |
| `wen_ying` | 闻莺 | `bashful_girl` | 小格蕾修 |
| `ct_0smtiokx` | 自定义模板 | `sweet_lady` | 大格蕾修 |
| `ct_7vifprod` | 自定义模板 | `mature_woman` | 姬子 |

### 5. 群聊实际合成逻辑

群聊路由内还有一份 `_ttsV`，它和前端语音库里的 GPT-SoVITS 模型表重复。合成时调用：

```js
fetch("http://127.0.0.1:8000/infer_classic", {
  method: "POST",
  body: JSON.stringify({
    version: "v4",
    gpt_model_name: model.g,
    sovits_model_name: model.s,
    ref_audio_path: model.r,
    prompt_text: model.p,
    prompt_text_lang: "中文",
    text,
    text_lang: "中英混合",
    speed_facter: 1,
    media_type: "wav"
  })
})
```

生成的音频会写入：

```text
%APPDATA%\socratopia\project-data\tts-cache\
```

然后返回：

```text
/api/tts-audio?file=xxx.wav
```

## 课堂流程与群聊流程差异表

| 对比项 | 课堂流程 | 群聊流程 |
|---|---|---|
| 执行位置 | 前端 React 页面 | 服务端 `/api/groupchat` route |
| 选择依据 | `candidateId`、语言、性别、`companionVoices` | LLM 输出行中的发言人名字，反查世界数据伙伴 |
| 保存值优先级 | `companionVoices["candidateId:lang"]` > `companionVoices[candidateId]` > `th` > `defaultVoiceFor` | `_c.voiceKey` > `_c.voice` > `_cidToVk` > hash fallback |
| 默认映射表 | `th`，位于 `page` chunk | `_cidToVk`，位于 `groupchat/route.js` |
| 模型表 | `4137` / `3461` 中的 `M` | `groupchat/route.js` 中的 `_ttsV` |
| 语速 | 使用 UI 中的 `companionVoiceSpeeds` / 1、1.2、1.4 | 固定 `speed_facter: 1` |
| 音频处理 | 前端拿到 blob 后直接播放 | 服务端下载音频，写入 `tts-cache`，再返回文件 URL |
| 失败兜底 | 模型 key 不存在时 `M[t] || M.soft_girl` | 名字匹配失败时 `_vk = ... || "soft_girl"`；模型 key 不存在时 `_ttsV[t] || _ttsV.soft_girl` |

## 当前不一致点

| 伙伴 | 课堂默认 | 群聊默认 | 是否一致 |
|---|---|---|---|
| 邱灵霓 | 爱莉希雅 | 次生银翼 | 否 |
| 鹿语萌 | 布洛妮娅 | 大格蕾修 | 否 |
| 闻莺 | 花火 | 小格蕾修 | 否 |
| 陶砺 | 旧 key：`zh_reliable_executive` | 花火 | 否 |
| 霍云来 | 旧 key：`zh_stubborn_friend` | 爱莉希雅 | 否 |
| 孟煦 | 旧 key：`gentleman` | 大黑塔 | 否 |
| 孙悟空 | 旧 key：`zh_humorous_elder` | 姬子 | 否 |
| 福尔摩斯 | 旧 key：`zh_reliable_executive` | 布洛妮娅 | 否 |
| 爱丽丝 | 芙宁娜 | 芙卡洛斯 | 否 |

如果用户已经在伙伴管理界面手动保存过 `voiceKey`，群聊会优先使用这个保存值，因此不一定落入 `_cidToVk` 默认表。

## 修改建议

如果目标是“课堂和群聊同一伙伴使用同一声音”，建议把默认映射收敛到一处，至少人工同步以下位置：

1. `page-3a1fef7566e26c43.js` 中的 `th`。
2. `resources/server/.next/server/app/page.js` 中对应的 `th`。
3. `groupchat/route.js` 中的 `_cidToVk`。
4. 如新增或改名 voiceKey，同步 `4137-131d0676e3b5bef7.js`、`3461.js`、`groupchat/route.js` 中的模型表。

更稳的方向是：让群聊也只读取世界数据里的 `voiceKey`，并由伙伴管理界面负责写入；默认值则统一从同一张 `candidateId -> voiceKey` 表生成，避免 `th` 和 `_cidToVk` 长期漂移。
