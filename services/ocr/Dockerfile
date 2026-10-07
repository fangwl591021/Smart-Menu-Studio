# Linux/amd64 native OCR; no Umi desktop and no AI keys in this image.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS unit-tests
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY umi_core ./umi_core
COPY fetch_engine.py audit_archive.py ./
COPY tests ./tests
RUN useradd --uid 10001 --no-create-home ocr-test
USER 10001:10001
RUN --network=none python -m unittest discover -s tests -v
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
    PYTHONPATH=/app LD_LIBRARY_PATH=/opt/paddle/lib OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=assets /opt/paddle /opt/paddle
COPY umi_core ./umi_core
COPY tests/native_smoke.py ./tests/native_smoke.py
COPY licenses ./licenses
COPY UPSTREAM.json native-artifacts.json ./
USER 10001:10001
RUN --network=none python /app/tests/native_smoke.py
EXPOSE 8080
CMD ["python", "-m", "umi_core.server"]
