#!/bin/sh
set -eu

: "${FFMPEG_VERSION:?FFMPEG_VERSION is required}"
: "${FFMPEG_SHA256:?FFMPEG_SHA256 is required}"

archive="/tmp/ffmpeg-${FFMPEG_VERSION}.tar.xz"
source_directory="/tmp/ffmpeg-${FFMPEG_VERSION}"
source_url="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"

curl --fail --location --proto '=https' --tlsv1.2 --output "$archive" "$source_url"
printf '%s  %s\n' "$FFMPEG_SHA256" "$archive" | sha256sum --check --strict
tar --extract --file "$archive" --directory /tmp

cd "$source_directory"
set -- \
  --prefix=/opt/ffmpeg \
  --disable-autodetect \
  --disable-debug \
  --disable-doc \
  --disable-everything \
  --disable-gpl \
  --disable-network \
  --disable-nonfree \
  --disable-static \
  --enable-shared \
  --enable-avcodec \
  --enable-avdevice \
  --enable-avfilter \
  --enable-avformat \
  --enable-avutil \
  --enable-ffmpeg \
  --disable-ffplay \
  --disable-ffprobe \
  --enable-swresample \
  --enable-swscale \
  --enable-libopus \
  --enable-decoder=opus,pcm_f32le,pcm_f64le,pcm_s16le,pcm_s24le,pcm_s32le \
  --enable-demuxer=ogg,pcm_s16le,wav \
  --enable-encoder=libopus,pcm_f32le \
  --enable-filter=aformat,anull,aresample \
  --enable-muxer=ogg,pcm_f32le \
  --enable-parser=opus \
  --enable-protocol=file,pipe

printf '%s\n' "$@" > /tmp/ffmpeg-configure-arguments.txt
./configure "$@"
make -j"$(getconf _NPROCESSORS_ONLN)"
make install

mkdir -p /opt/ffmpeg/share/source
cp "$archive" "/opt/ffmpeg/share/source/ffmpeg-${FFMPEG_VERSION}.tar.xz"
cp COPYING.LGPLv2.1 LICENSE.md /opt/ffmpeg/share/source/
cp /tmp/ffmpeg-configure-arguments.txt /opt/ffmpeg/share/source/configure-arguments.txt
printf '%s\n' "$source_url" > /opt/ffmpeg/share/source/source-url.txt
printf '%s  %s\n' "$FFMPEG_SHA256" "ffmpeg-${FFMPEG_VERSION}.tar.xz" \
  > /opt/ffmpeg/share/source/SHA256SUMS
