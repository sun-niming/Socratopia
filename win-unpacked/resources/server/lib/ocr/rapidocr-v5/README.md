# RapidOCR-json-v5

Offline OCR engine for Windows, based on [RapidOCR-json](https://github.com/hiroi-sora/RapidOCR-json) with [PP-OCRv5](https://github.com/PaddlePaddle/PaddleOCR) model support.

Outputs JSON via stdin/stdout pipeline — ideal for integration with other applications.

## Features

- **PP-OCRv5 models**: Upgraded from v3 to v5 for improved Chinese/English/multilingual recognition
- **JSON pipeline interface**: Communicate via stdin/stdout, no file I/O required for batch processing
- **Model metadata dictionary**: Automatically reads character list from ONNX model metadata (no external keys file needed for v5)
- **Static linking**: Produces a single self-contained `.exe` with no runtime DLL dependencies

## Quick Start (Pre-built Binary)

Download the latest release from the [Releases](../../releases) page. The archive includes:

```
RapidOCR-json-v5/
├── RapidOcrOnnx.exe          # OCR engine
└── models/                   # PP-OCRv5 ONNX models
    ├── ch_PP-OCRv5_det_mobile.onnx
    ├── ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx
    ├── ch_PP-OCRv5_rec_mobile.onnx
    └── ppocrv5_dict.txt       # Fallback dictionary (v5 models have it built-in)
```

### Usage

```bash
# Start the engine
RapidOcrOnnx.exe --models=models

# Send JSON requests via stdin (one per line)
{"image_path":"C:/path/to/image.png"}
{"image_base64":"/9j/4AAQ...base64..."}
```

### Output Format

**Success with text**:
```json
{"code":100,"data":[
  {"box":[[4,-1],[519,-1],[519,27],[4,27]],"score":0.98,"text":"Recognized text"},
  ...
]}
```

**No text found**:
```json
{"code":101,"data":"No text found in image."}
```

**Error**:
```json
{"code":200,"data":"Error message"}
```

### Command-Line Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--models` | Model directory | `models` |
| `--det` | Detection model filename | `ch_PP-OCRv5_det_mobile.onnx` |
| `--cls` | Classification model filename | `ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx` |
| `--rec` | Recognition model filename | `ch_PP-OCRv5_rec_mobile.onnx` |
| `--keys` | Dictionary filename (optional, v5 reads from model metadata) | `ppocr_keys_v1.txt` |
| `--numThread` | Number of CPU threads | `4` |
| `--padding` | White border width | `50` |
| `--maxSideLen` | Max image side length (downscale) | `1024` |
| `--boxScoreThresh` | Text box confidence threshold | `0.5` |
| `--boxThresh` | Binarization threshold | `0.3` |
| `--unClipRatio` | Text box expansion ratio | `1.6` |
| `--doAngle` | Enable direction classification | `1` |
| `--mostAngle` | Enable angle voting | `1` |
| `--GPU` | GPU index (-1 = CPU) | `-1` |
| `--ensureAscii` | ASCII escape output | `0` |
| `--ensureLogger` | Enable logging | `0` |
| `--model_set` | Preset model combination for language switching (see below) | `ch-v5` |

---

## Build From Source

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Visual Studio | 2022 (Community/Pro/Enterprise) | Install "Desktop development with C++" workload |
| CMake | >= 3.17 | [Download](https://cmake.org/download/) |
| Python | >= 3.8 | Only needed to extract dictionary from v5 model (optional) |

### Step 1: Download Third-Party Libraries

Run the included download script (requires 7-Zip in PATH):

```cmd
download-deps.bat
```

This automatically downloads and extracts:
- **ONNX Runtime 1.18.0** (static, MT) → `onnxruntime-static/windows-x64/`
- **OpenCV 4.8.1** (static, MT) → `opencv-static/windows-x64/`

> If the script fails (network issues, no 7-Zip), see [Manual Download](#manual-download) below.

### Step 2: Build

Open **"x64 Native Tools Command Prompt for VS 2022"** from the Start Menu, then:

```cmd
cd RapidOCR-json-v5
build.bat
```

The interactive script will ask:

1. **Build type**: Release (recommended) / Debug
2. **Output type**: BIN (executable, recommended) / JNI (Java) / CLIB (C library)
3. **CRT linkage**: /MT static (recommended) / /MD dynamic
4. **Architecture**: x64 (recommended) / x86

Build output:

```
win-BIN-CPU-x64/install/bin/RapidOcrOnnx.exe
```

### Step 3: Verify

From the project root directory:

```cmd
win-BIN-CPU-x64\install\bin\RapidOcrOnnx.exe --models=models
```

Expected startup output (stdout):
```
Loaded character list from ONNX model metadata (18383 chars)
total keys size(18385)
RapidOCR-json v0.2.0
OCR init completed.
```

Then type a JSON request and press Enter:

```json
{"image_path":"images/1.jpg"}
```

Expected JSON response (one line, formatted here for readability):
```json
{"code":100,"data":[
  {"box":[[240,7],[553,7],[553,28],[240,28]],"score":0.9997,
   "text":"人生活的真实写照：善有善报，恶有恶报。"},
  {"box":[[8,46],[524,46],[524,70],[8,70]],"score":0.9907,
   "text":"我们中国人有一句俗语说：\u201c种瓜得瓜，种豆得豆。\u201c而这就是每个"},
  ...
  {"box":[[42,503],[559,507],[558,535],[42,531]],"score":0.9838,
   "text":"If the past has taught us anything, it is that every cause brings"}
]}
```

Press `Ctrl+C` to exit.

---

## Multi-Language Support (`--model_set`)

PP-OCRv5 supports **106 languages** across 11 recognition models. The `--model_set` parameter lets you switch between them without manually specifying `--det`, `--cls`, `--rec`, and `--keys`.

### Available Model Sets

| model_set | Supported Languages | rec Model | Included in Release |
|-----------|---------------------|-----------|---------------------|
| `ch-v5` (default) | Simplified Chinese, Traditional Chinese, English, Japanese, Korean, Pinyin | `ch_PP-OCRv5_rec_mobile.onnx` | Yes |
| `ru-v5` | Russian, Belarusian, Ukrainian, Serbian (Cyrillic), Bulgarian, Mongolian, Kazakh, Kyrgyz, Tajik, Macedonian, and 25+ other Cyrillic-script languages | `cyrillic_PP-OCRv5_rec_mobile.onnx` | No |
| `eslav-v5` | Russian, Belarusian, Ukrainian, English | `eslav_PP-OCRv5_rec_mobile.onnx` | No |
| `latin-v5` | French, German, Italian, Spanish, Portuguese, Dutch, Danish, Swedish, Norwegian, Polish, Czech, Slovak, Hungarian, Romanian, Turkish, Vietnamese, and 32 other Latin-script languages (47 total) | `latin_PP-OCRv5_rec_mobile.onnx` | No |
| `arabic-v5` | Arabic, Persian, Uyghur, Urdu, Pashto, Kurdish, Sindhi, Balochi, English | `arabic_PP-OCRv5_rec_mobile.onnx` | No |
| `th-v5` | Thai, English | `th_PP-OCRv5_rec_mobile.onnx` | No |
| `el-v5` | Greek, English | `el_PP-OCRv5_rec_mobile.onnx` | No |
| `devanagari-v5` | Hindi, Marathi, Nepali, Bihari, Maithili, Bhojpuri, Sanskrit, and 7 other Devanagari-script languages | `devanagari_PP-OCRv5_rec_mobile.onnx` | No |
| `ta-v5` | Tamil, English | `ta_PP-OCRv5_rec_mobile.onnx` | No |
| `te-v5` | Telugu, English | `te_PP-OCRv5_rec_mobile.onnx` | No |

> **Note**: `ch-v5` (the default PP-OCRv5 Chinese model) already covers Simplified/Traditional Chinese, English, Japanese, Korean, and Pinyin in a single model. For most use cases, no switching is needed.

### Downloading Additional Models

The release only includes `ch-v5` models. To use other languages, download the corresponding rec model and place it in the `models/` directory:

1. Download ONNX rec models from the [RapidOCR ModelScope repository](https://www.modelscope.cn/models/RapidAI/RapidOCR/tree/master/onnx/PP-OCRv5) — the official source for all RapidOCR ONNX models, including all PP-OCRv5 multilingual rec models.
2. Place the `.onnx` file in the `models/` directory (filename should match the table above, e.g. `cyrillic_PP-OCRv5_rec_mobile.onnx`).
3. Use `--model_set` to select it, or use `--rec` to specify the filename directly.

The detection (`det`) and classification (`cls`) models are shared across all language sets — no need to download separate ones.

### Usage

```bash
# Default (ch-v5: Chinese/English/Japanese/Korean)
RapidOcrOnnx.exe --models=models --image_path=test.png

# Russian OCR (requires downloading cyrillic rec model)
RapidOcrOnnx.exe --models=models --model_set=ru-v5 --image_path=test.png

# Manual override: specify rec model directly
RapidOcrOnnx.exe --models=models --rec=cyrillic_PP-OCRv5_rec_mobile.onnx --image_path=test.png
```

Explicit `--det`/`--cls`/`--rec`/`--keys` arguments take priority over `--model_set`, allowing advanced overrides.

### Technical Details

- v5 rec models have the character dictionary embedded in ONNX metadata — no external `keys` file needed.
- `--model_set` does not pass `--keys` by default; the engine reads from model metadata automatically.
- Detection (`det`) and classification (`cls`) models are shared across all model sets.

### Official References

- [PP-OCRv5 Multilingual Recognition](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.en.md) — full list of 106 supported languages and model downloads
- [RapidOCR](https://github.com/RapidAI/RapidOCR) — ONNX model conversion

---

## Complete Quick Start (Download → Build → Run)

```cmd
git clone https://github.com/inkling119/RapidOCR-json-v5.git
cd RapidOCR-json-v5
download-deps.bat
build.bat
:: Select: 1) Release  1) BIN  1) /MT  1) x64
win-BIN-CPU-x64\install\bin\RapidOcrOnnx.exe --models=models
```

Then send JSON via stdin:
```json
{"image_path":"images/1.jpg"}
```

---

<details>
<summary id="manual-download">Manual Download (if download-deps.bat fails)</summary>

#### ONNX Runtime 1.18.0 (static, MT)

Download from [RapidAI/OnnxruntimeBuilder Releases](https://github.com/RapidAI/OnnxruntimeBuilder/releases):

```
onnxruntime-v1.18.0-windows-vs2022-x64-static-mt.7z
```

Extract and copy files to:

```
onnxruntime-static/windows-x64/
├── OnnxRuntimeConfig.cmake    ← from archive root
├── include/                   ← from archive (flat structure, no subdirectories)
│   ├── onnxruntime_cxx_api.h
│   ├── onnxruntime_c_api.h
│   └── ...
└── lib/
    └── onnxruntime.lib        ← single file
```

> **Important**: ONNX Runtime v1.18 uses a **flat include structure** — header files are directly in `include/`, not in `include/onnxruntime/core/session/`. The source code has already been modified to match this.

#### OpenCV 4.8.1 (static, MT)

Download from [RapidAI/OpenCVBuilder Releases](https://github.com/RapidAI/OpenCVBuilder/releases):

```
opencv-4.8.1-windows-vs2022-mt.7z
```

Extract into:

```
opencv-static/windows-x64/     ← extract the archive's contents here
```

The archive already contains the correct directory structure (`OpenCVConfig.cmake`, `include/`, `x64/vc17/staticlib/`).

</details>

---

## Modifications from Original RapidOCR-json

This project is based on [hiroi-sora/RapidOCR-json](https://github.com/hiroi-sora/RapidOCR-json) (`cpp/` directory). The following changes were made to support PP-OCRv5:

| Change | File(s) | Description |
|--------|---------|-------------|
| Include paths | `DbNet.h`, `CrnnNet.h`, `AngleNet.h`, `OcrLite.h`, `OcrUtils.h` | `#include <onnxruntime/core/session/...>` → `#include <onnxruntime_cxx_api.h>` (flat structure for v1.18) |
| Detection normalization | `DbNet.h` | `mean={0.485*255,...}` → `mean={127.5,...}` (v5 uses `(x/255-0.5)/0.5`) |
| Classification input size | `AngleNet.h` | `192x48` → `160x80` (v5 shape) |
| C++ standard | `CMakeLists.txt` | C++11 → C++17 (required by onnxruntime v1.18) |
| Default model names | `tools.cpp` | v3 model names → v5 model names |
| Missing header | `OcrLite.cpp` | Added `#include <cstdarg>` (VS2022 fix) |
| Model metadata dictionary | `CrnnNet.cpp` | Added `GetCharacterListFromModelMetadata()` — reads character list from ONNX model metadata, matching Python RapidOCR behavior |
| Keys file optional | `main.cpp`, `OcrLiteJni.cpp` | `-4`/`--keys` is now optional; v5 models have embedded dictionary |
| Model set parameter | `main.h`, `main.cpp`, `tools.h`, `tools.cpp` | Added `--model_set` for quick language switching with 15 preset combinations |

**Total: ~15 lines of source changes + 1 new method for metadata reading.**

---

## License

Apache License 2.0 — same as the original RapidOCR-json and RapidOcrOnnx projects.

See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.