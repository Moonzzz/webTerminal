#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/build-docker-image.sh [image[:tag]] [docker build args...]

Builds a linux/amd64 Docker image. On macOS, docker buildx is used with --load.

Environment variables:
  PLATFORM    Target platform. Default: linux/amd64
  DOCKERFILE  Dockerfile path. Default: Dockerfile
  CONTEXT     Build context. Default: .
USAGE
  exit 0
fi

IMAGE_REF="${1:-webterminal:latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"
CONTEXT="${CONTEXT:-.}"

if (($# > 0)); then
  shift
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found" >&2
  exit 127
fi

os_name="$(uname -s)"
cpu_arch="$(uname -m)"

if [[ "${os_name}" == "Darwin" ]]; then
  if ! docker buildx version >/dev/null 2>&1; then
    echo "docker buildx is required on macOS for ${PLATFORM} builds" >&2
    exit 1
  fi

  cmd=(docker buildx build --platform "${PLATFORM}" --load -f "${DOCKERFILE}" -t "${IMAGE_REF}")
elif [[ "${cpu_arch}" == "x86_64" || "${cpu_arch}" == "amd64" ]]; then
  cmd=(docker build --platform "${PLATFORM}" -f "${DOCKERFILE}" -t "${IMAGE_REF}")
else
  if ! docker buildx version >/dev/null 2>&1; then
    echo "docker buildx is required on ${os_name}/${cpu_arch} for ${PLATFORM} builds" >&2
    exit 1
  fi

  cmd=(docker buildx build --platform "${PLATFORM}" --load -f "${DOCKERFILE}" -t "${IMAGE_REF}")
fi

cmd+=("$@")
cmd+=("${CONTEXT}")

echo "Building ${IMAGE_REF} for ${PLATFORM}"
printf 'Command:'
printf ' %q' "${cmd[@]}"
printf '\n'

"${cmd[@]}"
