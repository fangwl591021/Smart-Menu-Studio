# Native release redistribution checkpoint

Umi Python files retain both upstream MIT licenses. PaddleOCR-json itself retains
its upstream Apache 2.0 license. Pillow's installed distribution retains its
MIT-CMU license and notices in site-packages.

The pinned PaddleOCR-json Linux release also contains precompiled third-party
libraries (OpenCV, Paddle Inference, oneDNN/MKLDNN, Intel MKL/OpenMP, ONNX Runtime,
Paddle2ONNX and libgomp). Its release archive has no LICENSE/NOTICE files.
The PaddleOCR-json Apache license must not be treated as covering all these
bundled libraries. Match their versions and preserve the applicable upstream
redistribution notices before publishing the native container image.

`nativeThirdPartyNoticesReviewed` is deliberately false. The deployment guard
refuses to publish until this review and required bundled notices are complete.
Do not turn the flag on merely to get a deployment to pass.

This checkpoint does not block local source tests or examination of the official
release. No native image has been published by this task.

## Evidence collected on 2026-10-07

The fixed release archive was checked with Linux `ldd` and embedded build strings,
without processing customer documents. The runtime dependency closure includes
OpenCV core/imgcodecs/imgproc 4.10.0 (embedded revision `169a274`, built 2024-08-28),
ONNX Runtime 1.11.1, Paddle2ONNX 1.0.0rc2, `libdnnl.so.2`, Intel OpenMP
5.0.20190109, and a bundled `libgomp.so.1`. Unused additional libraries are also
present in the archive. Paddle's pinned build instructions reference its 2.3.2
inference package, but this is not proof of every embedded third-party version.

Preserved upstream notice files:

| File | Exact upstream source |
| --- | --- |
| ONNXRuntime.MIT.txt | https://raw.githubusercontent.com/microsoft/onnxruntime/v1.11.1/LICENSE |
| ONNXRuntime.ThirdPartyNotices.txt | https://raw.githubusercontent.com/microsoft/onnxruntime/v1.11.1/ThirdPartyNotices.txt |
| OpenCV.Apache-2.0.txt | https://raw.githubusercontent.com/opencv/opencv/4.10.0/LICENSE |

These files are copied without rewriting their legal text (line endings normalized
to LF). The complete ONNX third-party notices are preserved, not just its MIT
license. The OpenCV license alone does not cover its embedded image codecs/IPP.

The review remains **incomplete**: match Paddle Inference's embedded dependency
versions and notices, OpenCV's enabled codec/IPP licenses, Intel MKL/OpenMP package
notices, oneDNN, Paddle2ONNX, and bundled GCC runtime licensing/source obligations.
Do not infer all libraries are Apache-licensed, and do not use a newer unrelated
Intel license to authorize an older binary. Source publication and a closed CI
bootstrap do not distribute this native release or mean native OCR is deployed.

Primary build provenance:
https://github.com/hiroi-sora/PaddleOCR-json/blob/828e3fd121de59799bd5934faa6b8858c4969ba5/cpp/README-linux.md

Container publication stays blocked until these remaining notices are matched and
bundled, or the engine is rebuilt from a fully traceable dependency set.
