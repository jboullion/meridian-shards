#!/bin/sh
# Keeps blakserv's saves from piling up on the VM. blakserv writes a whole save set every half
# hour (accounts, dynarscs, gameuser and striings, each named by the save's time) and never
# deletes one: 474 sets, 1.7 GB, after ten days (2026-10-17).
#
# Keeps the newest KEEP_RECENT sets (48: a day of half-hourly saves), the last set of each day for
# KEEP_DAYS days, and always the set lastsave.txt names (the one blakserv loads). Touches nothing
# else in the volume (lastsave.txt, old-world/). DRY_RUN=1 says what it would remove.
#
# Run as root, hourly at :17 (clear of the saves at :00 and :30), from /etc/cron.d (README.md,
# "Running it"):
#   17 * * * * root sh /home/shards/meridian-shards/deploy/prune-saves.sh >> /var/log/meridian-shards-saves.log 2>&1
set -eu

KEEP_RECENT=${KEEP_RECENT:-48}
KEEP_DAYS=${KEEP_DAYS:-14}
VOLUME=${VOLUME:-meridian-shards_savegame}
DRY_RUN=${DRY_RUN:-0}

dir=$(docker volume inspect -f '{{.Mountpoint}}' "$VOLUME")
cd "$dir"

last=$(sed -n 's/^LASTSAVE \([0-9][0-9]*\).*/\1/p' lastsave.txt)
if [ -z "$last" ]; then
  echo "$(date -u '+%F %T') no LASTSAVE in lastsave.txt: nothing removed"
  exit 1
fi

now=$(date +%s)
since=$((now - KEEP_DAYS * 86400))
# every save's time, newest first
times=$(ls | sed -n -E 's/^(accounts|dynarscs|gameuser|striings)\.([0-9]+)$/\2/p' | sort -run)

keep=" $last "
days=" "
n=0
for t in $times; do
  n=$((n + 1))
  if [ "$n" -le "$KEEP_RECENT" ]; then
    keep="$keep$t "
  elif [ "$t" -ge "$since" ]; then
    # newest first, so the first set seen on a day is its last
    d=$(date -u -d "@$t" +%Y%m%d)
    case "$days" in
      *" $d "*) ;;
      *)
        days="$days$d "
        keep="$keep$t "
        ;;
    esac
  fi
done

removed=0
for t in $times; do
  case "$keep" in *" $t "*) continue ;; esac
  removed=$((removed + 1))
  if [ "$DRY_RUN" = 1 ]; then
    echo "would remove the save of $(date -u -d "@$t" '+%F %T')"
  else
    rm -f "accounts.$t" "dynarscs.$t" "gameuser.$t" "striings.$t"
  fi
done

kept=$(($(echo "$times" | grep -c . || true) - removed))
echo "$(date -u '+%F %T') $([ "$DRY_RUN" = 1 ] && echo 'would remove' || echo 'removed') $removed save sets, kept $kept (last save $last)"
