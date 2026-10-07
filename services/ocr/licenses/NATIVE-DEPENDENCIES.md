# Native release redistribution checkpoint

Latest engineering checkpoint, 2026-10-07: the three historical items below now
have source/provenance records and a corresponding-source delivery plan.
See PocketFFT's retained original ZIP, Paddle.Eigen.Scope.txt and
NativeSources.SourceAvailability.txt. The inventory pins 58 notices/records,
the source ZIP and four source downloads. Its completed flag records this
engineering review, not a legal certification or a native deployment result.
The final image must verify all retained source bytes and pass real native smoke
before Wrangler publication. The historical unresolved sections below describe
the earlier failure; they are not the current pending-item list.

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

## Follow-up: pinned provenance and notice inventory

The original broad missing-notice list above has now been narrowed. The retained
inventory is `native-review.json`: 51 license/notice files with exact SHA256 and
upstream source URLs (45 newly retained in this follow-up). Legal text is complete;
line endings are normalized to LF. Collecting texts alone is not a legal conclusion
or a completed redistribution review.

- The official Paddle Inference 2.3.2 archive, SHA256
  `f09d5082b167e8301dc741b629baa0ab30e0342a8d7b62c322fde324f9404dbf`,
  contains byte-identical Paddle Inference, oneDNN, ONNX Runtime, Paddle2ONNX,
  Intel OpenMP and MKLML libraries to the pinned OCR release. This establishes
  the package provenance, rather than merely inferring it from build instructions.
- The pinned oneDNN revision `9a35435c18722ff17a48fb60bceac42bfdf78754` appears
  in its binary. Both its Apache license and complete third-party notice text
  are retained.
- The official MKLML archive's MD5 matches the published Paddle 2.3.2 build
  recipe (`bc6a7faea6a2a9ad31752386f3ae87da`); its SHA256 is
  `8b190a13cc21be6030363d119b3a8e0830dd8601902900fa0c05d1129d55b5ab`.
  Full binary hashes differ from the stripped release, but every file-backed
  SHF_ALLOC ELF section matches. The April 2018 license and third-party file
  from this specific 2019.0.5 package are retained, not a substituted modern EULA.
  The helper compares bytes; it does not execute, decompile or disassemble code.
- OpenCV's embedded build information identifies 4.10.0 (`169a274`), zlib 1.3.1,
  libjpeg-turbo 3.0.3, libpng 1.6.43, libtiff 4.6.0, OpenJPEG 2.5.0,
  OpenEXR 2.3.0 and IPPICV 2021.11.0. Corresponding OpenCV-vendored license
  texts, ITT/OpenCL, protobuf and FlatBuffers notices are retained.
- The IPPICV package matches the MD5 in OpenCV 4.10.0's pinned build recipe
  (`0f2745ff705ecae31176dad437608f6f`); SHA256 is
  `86c53ddd40c2889f6bc1040bcbd95db9b49b7ecf5321c08907ef8465f3053a7a`.
  Its October 2022 EULA and full third-party file are retained. Interrupted
  downloads were not accepted; the complete archive was hash-checked first.
- Paddle's CPU dependency notice texts, Eigen's complete COPYING texts, and
  the pinned Paddle2ONNX submodule notices are retained conservatively. This
  does not mean every optional dependency is in the runtime or resolve the
  compiled-use/source-availability obligations below.

Acknowledgement: this software is based in part on the work of the Independent
JPEG Group.

### Remaining blockers (not bypassed)

1. `pocketfft-source`: the original `release_for_eigen` source website currently
   presents a manual anti-bot verification. No challenge was solved, replayed or
   bypassed. Exact source/notice verification needs human access or a legitimately
   supplied matching source file, or a separately approved traceable rebuild.
2. `eigen-compiled-scope`: verify which MPL/LGPL-covered Eigen components were
   compiled and the applicable source-availability requirements. Retaining all
   COPYING files is not by itself proof these obligations have been met.
3. `bundled-gcc-runtime`: match the bundled `libgomp.so.1` to its source and
   applicable GCC runtime exception obligations, or deliberately replace it with
   the distribution-provided runtime and verify actual native behavior.

`nativeThirdPartyNoticesReviewed` and inventory `completed` both stay false.
Predeploy also checks engine SHA256, notice hashes and the empty unresolved list;
changing the boolean alone cannot authorize publication. Unit/source builds can
check inventory integrity without falsely marking the review complete.

Audit helper (trusted archives only, offline, no file extraction or native code
execution): `python audit_archive.py ARCHIVE.tgz ENGINE_DIRECTORY`.
