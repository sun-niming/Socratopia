# Third-Party Notices

This project incorporates or is built upon the following third-party software.
Each component is licensed under its respective license.

## RapidOCR-json

- **Source**: https://github.com/hiroi-sora/RapidOCR-json
- **License**: Apache 2.0
- **Usage**: This project is based on the RapidOCR-json `cpp/` source code.
  Modifications were made to support PP-OCRv5 models (see README for details).

## RapidOcrOnnx

- **Source**: https://github.com/RapidAI/RapidOcrOnnx
- **License**: Apache 2.0
- **Usage**: Original C++ OCR engine. RapidOCR-json is derived from this project.

## ONNX Runtime

- **Source**: https://github.com/microsoft/onnxruntime
- **Version**: 1.18.0
- **License**: MIT
- **Usage**: Inference engine for ONNX models. Pre-built static library is
  downloaded separately (see README for download instructions).

## OpenCV

- **Source**: https://github.com/opencv/opencv
- **Version**: 4.8.1
- **License**: Apache 2.0
- **Usage**: Image processing. Pre-built static library is downloaded
  separately (see README for download instructions).

## PP-OCRv5 Models

- **Source**: https://www.modelscope.cn/models/RapidAI/RapidOCR
- **License**: Apache 2.0
- **Usage**: OCR models (detection, classification, recognition) included
  in the `models/` directory.

## nlohmann/json

- **Source**: https://github.com/nlohmann/json
- **License**: MIT
- **Usage**: JSON parsing, included as a single header file
  (`include/nlohmann_json.hpp`).

## Clipper (Angus Johnson)

- **Source**: http://www.angusj.com/delphi/clipper.php
- **License**: Boost Software License 1.0
- **Usage**: Polygon clipping for text box processing
  (`include/clipper.hpp`, `src/clipper.cpp`).
