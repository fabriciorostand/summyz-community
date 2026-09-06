# Third-party notices

This file covers the dependency set prepared for Summyz Community 1.0.0. It does not
change any third-party license. The release SBOMs generated from the exact commit and
images are the authoritative package inventories.

Summyz Community itself is licensed under the Summyz Community License 1.0 in
`LICENSE.md`. Third-party software and model weights are not covered by that license.

## FFmpeg and libopus

The Docker builds compile FFmpeg 8.1.2 from source with the LGPL-only configuration in
`docker/ffmpeg/build-lgpl.sh`. GPL and nonfree components, network protocols, and
autodetection are disabled. PyAV is built from source and dynamically linked to those
shared FFmpeg libraries. The image preserves the FFmpeg source archive, checksum,
configure arguments, source URL, and LGPL text under `/opt/ffmpeg/share/source`.

FFmpeg is licensed under the GNU Lesser General Public License version 2.1 or later in
this configuration. libopus is distributed under its BSD-style license. System-package
copyright files remain inside each image under `/usr/share/doc`.

- FFmpeg: https://ffmpeg.org/
- FFmpeg legal information: https://ffmpeg.org/legal.html
- Opus codec: https://opus-codec.org/license/
- PyAV: https://github.com/PyAV-Org/PyAV

## Node.js runtime

The production dependency graph recorded in `package-lock.json` contains software under
MIT, MIT-0, Apache-2.0, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, and
`MIT OR CC0-1.0`. Package license files and notices are retained in `node_modules` inside
the locally built runtime image.

Notable Apache-2.0 components include Discord.js, `@discordjs/voice`, the other
`@discordjs/*` runtime packages, and `prism-media`. Notable BSD-3-Clause components
include `fast-uri`, `global-agent`, `light-my-request`, and `secure-json-parse`.
The complete list, versions, package URLs, and detected licenses must be read from the
CycloneDX and SPDX release SBOMs, rather than copied from this human-maintained summary.

Node.js and the Debian base image contain their own third-party components and notices.
The Dockerfile is pinned to the exact base-image digest recorded in the release source.

## Python transcription runtime

`services/faster-whisper/requirements.lock` pins the complete Python graph with hashes.
The principal licenses detected from the installed distributions are:

| Components | License family |
| --- | --- |
| faster-whisper, CTranslate2, FastAPI, ONNX Runtime, Pydantic, PyYAML | MIT |
| PyAV, Click, fsspec, httpcore, httpx, idna, Starlette, Uvicorn | BSD |
| Hugging Face Hub, hf-xet, FlatBuffers, python-multipart, Requests | Apache-2.0 |
| certifi | MPL-2.0 |
| tqdm | MPL-2.0 AND MIT |
| typing-extensions | PSF-2.0 |
| packaging | Apache-2.0 OR BSD-2-Clause |

NumPy is BSD-3-Clause and its binary distribution also carries notices for bundled
OpenBLAS/LAPACK and GCC runtime libraries. `tokenizers` is published under Apache-2.0,
although its installed Python metadata may omit a normalized license expression. Exact
license texts and copyrights remain in the installed distribution metadata and are
captured by the image SBOM.

## Container images and accelerator runtimes

The Compose and Docker files pin these upstream artifacts by digest:

- Node.js 22 on Debian Bookworm slim;
- Python 3.12 on Debian Bookworm slim;
- Debian Bookworm slim for the FFmpeg builder;
- PostgreSQL 18.4 on Alpine;
- Ollama 0.33.3 CPU/NVIDIA and ROCm variants;
- NVIDIA CUDA 12.6.3 with cuDNN on Ubuntu 24.04.

Docker Official Image build recipes do not provide a single license for all operating
system packages inside an image. PostgreSQL is under the PostgreSQL License and Ollama
source is under MIT; those licenses do not replace the licenses of Alpine, Debian,
Ubuntu, CUDA, cuDNN, ROCm, or bundled libraries.

The NVIDIA target contains the NVIDIA Deep Learning Container License and CUDA/cuDNN
notices supplied by the upstream image. Use is subject to the NVIDIA terms and compatible
NVIDIA hardware. ROCm is licensed component by component; its upstream license inventory
and the release SBOM must be consulted instead of treating the whole ROCm image as MIT.

- NVIDIA CUDA EULA: https://docs.nvidia.com/cuda/eula/
- NVIDIA container licenses: https://docs.nvidia.com/deeplearning/frameworks/container-release-notes/licenses.html
- AMD ROCm licensing: https://rocm.docs.amd.com/en/latest/about/license.html
- PostgreSQL license: https://www.postgresql.org/about/licence/
- Ollama license: https://github.com/ollama/ollama/blob/main/LICENSE

Summyz Community 1.0.0 is planned as a source-only release. It does not publish prebuilt
Summyz container images; operators build the application images locally and pull the
pinned upstream images.

## Models selected by operators

No model weights are bundled in the source release. Operators may choose arbitrary
Ollama or Hugging Face/faster-whisper model identifiers. Each model remains subject to
its own license, acceptable-use policy, territorial restrictions, and other terms.
Summyz records available origin, revision/digest, and license metadata, but missing or
incorrect upstream metadata does not grant rights and does not block Community use.
The operator must review a model before downloading or using it.

## Release evidence

Run `npm run release:sbom` only from the clean, final release commit after building every
target named in `scripts/release/sbom-targets.json`. The command uses `npm sbom` for the
source dependency graph and Docker Scout for images. It emits CycloneDX and SPDX
documents, a manifest tied to the Git commit, and SHA-256 checksums under
`artifacts/sbom/`. Generated evidence is intentionally ignored by Git and must be attached
to the corresponding GitHub release.
