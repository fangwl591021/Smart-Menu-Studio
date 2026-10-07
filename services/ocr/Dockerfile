# Linux/amd64 native OCR; no Umi desktop and no AI keys in this image.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS unit-tests
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY umi_core ./umi_core
COPY fetch_engine.py ./
COPY tests ./tests
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]

FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS assets
WORKDIR /build
COPY requirements.txt native-artifacts.json fetch_engine.py ./
RUN python fetch_engine.py /opt/paddle

FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
RUN apt-get update && apt-get install --no-install-recommends -y libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home ocr
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    LD_LIBRARY_PATH=/opt/paddle/lib OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=assets /opt/paddle /opt/paddle
COPY umi_core ./umi_core
COPY tests/native_smoke.py ./tests/native_smoke.py
COPY licenses ./licenses
COPY UPSTREAM.json native-artifacts.json ./
USER 10001:10001
EXPOSE 8080
CMD ["python", "-m", "umi_core.server"]
