# blakserv (the unmodified Server 104 server) built for Linux. Its Linux build is
# 32-bit (blakserv/makefile.linux: -m32), so this needs the multilib toolchain to
# build and the i386 C/C++ runtime to run.
#
# Build context: deploy/.stage (made by `node tools/deploy/stage.ts`).

FROM ubuntu:24.04 AS build
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends g++-multilib make \
 && rm -rf /var/lib/apt/lists/*
COPY blakserv-src /src
WORKDIR /src/blakserv
# The makefile copies the binary into ../run/server when it's done. CFLAGS are
# makefile.linux's plus two, because the Linux build has fallen behind the Windows one:
#   -D__forceinline=inline   newer code (geometry.h, sendmsg.h) uses the MSVC keyword
#   -fno-unreachable-traps   three functions (InitMsgQueue, the console thread, MainServer)
#                            end without a return; GCC 14 turns that into a crash at -O0.
#                            Their results are never used.
RUN mkdir -p /src/run/server && make -f makefile.linux -j"$(nproc)" \
      CFLAGS='-m32 -I ../include -g -x c++ -DBLAK_PLATFORM_LINUX -Wno-write-strings -D__forceinline=inline -fno-unreachable-traps'

FROM ubuntu:24.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends lib32stdc++6 libc6-i386 netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/blakserv
COPY --from=build /src/blakserv/debug/blakserv ./blakserv
# The game: compiled Kod, resources and rooms from our build (they match the client's assets)
COPY gamedata/ ./
COPY blakserv.cfg ./blakserv.cfg
COPY maint.sh /usr/local/bin/maint
# Kod spells some room files differently from their names on disk (case only): link them
RUN chmod +x /usr/local/bin/maint ./blakserv && mkdir -p savegame channel loadkod  && while read -r file alias; do [ -n "$alias" ] && ln -sf "$file" "rooms/$alias"; done < room-aliases.txt

# Game state and logs live on volumes so a new image keeps the world
VOLUME ["/srv/blakserv/savegame", "/srv/blakserv/channel"]
# 5959: game (gateway and original clients); 9998: maintenance (stays inside the container)
EXPOSE 5959
# -i: the console interface on stdin (admin commands via `docker attach`). Without it
# the server daemonizes, and main_linux.c's Daemonize() never exits the parent, so two
# servers would run.
CMD ["./blakserv", "-i"]
