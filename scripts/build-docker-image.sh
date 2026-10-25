#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/build-docker-image.sh [image[:tag]] [--phase build|all] [docker build args...]

  build  Build and load the image (default).
  all    Build, verify startup, then export dist/<image>-<platform>_yyyyMMdd_HHmmss.tar.

Environment: PLATFORM=linux/amd64, DOCKERFILE=Dockerfile, CONTEXT=.
USAGE
}

phase=build
args=()
IMAGE_REF=webterminal:latest
PLATFORM="${PLATFORM:-linux/amd64}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"
CONTEXT="${CONTEXT:-.}"
container_id=''
export_temp=''

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --phase)
        if (($# < 2)); then echo '--phase requires build or all' >&2; exit 2; fi
        phase="$2"; shift 2 ;;
      --phase=*) phase="${1#*=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      --) shift; args+=("$@"); break ;;
      *) args+=("$1"); shift ;;
    esac
  done
  case "$phase" in build|all) ;; *) echo '--phase must be build or all' >&2; exit 2 ;; esac

  if ((${#args[@]} > 0)) && [[ "${args[0]}" != -* ]]; then
    IMAGE_REF="${args[0]}"
    args=("${args[@]:1}")
  fi
}

cleanup() {
  if [[ -n "$container_id" ]]; then docker rm -f "$container_id" >/dev/null || true; fi
  if [[ -n "$export_temp" ]]; then rm -f "$export_temp"; fi
}

build_image() {
  local os_name cpu_arch
  local -a cmd
  os_name="$(uname -s)"
  cpu_arch="$(uname -m)"
  if [[ "$os_name" == Darwin || ( "$cpu_arch" != x86_64 && "$cpu_arch" != amd64 ) ]]; then
    docker buildx version >/dev/null || { echo 'docker buildx is required' >&2; exit 1; }
    cmd=(docker buildx build --quiet --platform "$PLATFORM" --load)
  else
    cmd=(docker build --quiet --platform "$PLATFORM")
  fi
  cmd+=(-f "$DOCKERFILE" -t "$IMAGE_REF")
  # Bash 3.2 treats an empty array as unset under nounset.
  if ((${#args[@]} > 0)); then cmd+=("${args[@]}"); fi
  cmd+=("$CONTEXT")

  echo "Building $IMAGE_REF"
  "${cmd[@]}"
}

verify_image() {
  local endpoint url ready attempt
  echo 'Verifying startup'
  container_id="$(docker run --detach --platform "$PLATFORM" -p 127.0.0.1::3000 "$IMAGE_REF")"
  endpoint="$(docker port "$container_id" 3000/tcp)"
  url="http://$endpoint/login"
  ready=false
  for ((attempt = 0; attempt < 30; attempt++)); do
    if curl --noproxy '*' --fail --silent --max-time 2 --output /dev/null "$url"; then
      ready=true
      break
    fi
    if [[ "$(docker inspect --format '{{.State.Running}}' "$container_id")" != true ]]; then break; fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    docker logs "$container_id" >&2 || true
    curl --noproxy '*' --fail --silent --show-error --max-time 2 --output /dev/null "$url" || true
    echo 'Startup verification failed; export skipped' >&2
    exit 1
  fi

  docker rm -f "$container_id" >/dev/null
  container_id=''
}

export_image() {
  local output_dir image_name platform_name archive
  output_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist"
  image_name="${IMAGE_REF##*/}"
  image_name="${image_name//:/-}"
  platform_name="${PLATFORM//\//-}"
  archive="$output_dir/${image_name}-${platform_name}_$(date +%Y%m%d_%H%M%S).tar"
  mkdir -p "$output_dir"
  [[ ! -e "$archive" ]] || { echo 'Export file already exists' >&2; exit 1; }
  export_temp="$(mktemp "$output_dir/.docker-export.XXXXXX")"
  docker save --output "$export_temp" "$IMAGE_REF"
  mv "$export_temp" "$archive"
  export_temp=''
  echo "Exported $archive"
}

main() {
  parse_args "$@"
  command -v docker >/dev/null 2>&1 || { echo 'docker command not found' >&2; exit 127; }
  if [[ "$phase" == all ]]; then
    command -v curl >/dev/null 2>&1 || { echo 'curl command not found' >&2; exit 127; }
  fi

  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  build_image
  if [[ "$phase" == all ]]; then
    verify_image
    export_image
  fi
}

main "$@"
