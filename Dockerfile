FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 WISDOM_CONTAINER=1 WISDOM_DATA=/data WISDOM_LIBRARY=/media/Wisdom WISDOM_BASE="" WISDOM_PORT=9200 WISDOM_ADMIT=disabled
WORKDIR /app
COPY lookup.py model_router.py ./
COPY docs/lookup.md ./docs/lookup.md
COPY start.py starter.py server.py wisdom.py discussions.py library.py collection_export.py collection_revision.py authoring_contract.py authoring_admission.py authoring_toolkit.py mcp_api.py openapi.json ./
COPY authoring ./authoring/
COPY skill ./skill/
COPY docs/authoring ./docs/authoring/
COPY tools/author_collection.py tools/author_chapter.py ./tools/
COPY starter ./starter/
COPY static/discussions.js static/discussions.css ./static/
COPY docs/discussions.md ./docs/discussions.md
COPY static/index.html static/app.js static/wisdom.js static/base.css static/wisdom.css static/collections.css static/app.css static/manage.js static/manage.css static/wizard-appearance.js static/wizard-appearance.css static/icon.svg static/icon-192.png static/icon-512.png static/manifest.webmanifest ./static/
COPY static/wisdom-art/f/newsreader.woff2 static/wisdom-art/f/newsreader-italic.woff2 static/wisdom-art/f/fraunces.woff2 static/wisdom-art/f/fraunces-italic.woff2 static/wisdom-art/f/OFL-newsreader.txt static/wisdom-art/f/OFL-fraunces.txt ./static/wisdom-art/f/
COPY LICENSE ./
# Normalize source permissions: operator checkouts may use a private umask.
RUN chmod -R a+rX /app
EXPOSE 9200
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9200/healthz',timeout=2)"
CMD ["python", "start.py"]
