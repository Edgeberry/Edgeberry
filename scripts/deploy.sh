#!/bin/bash

##
# Edgeberry Device Software Deployment
# Deploys the current local project to a remote Edgeberry device over SSH.
# Intended for development use. Requires sshpass on the local machine.
#
# Usage:
#   ./scripts/deploy.sh
#
# Notes:
# - Interactive: prompts for host, user, and password.
# - Idempotent: re-running updates the remote app directory safely.
# - Quiet: hides noisy command output, shows clear step progress.
##

APPNAME=Edgeberry
APPCOMP=Core
SERVICENAME="io.edgeberry.core"
APPDIR=/opt/${APPNAME}/${APPCOMP}
SHAREDIR=/opt/${APPNAME}/share

DEFAULT_USER=spuq
DEFAULT_HOST=192.168.1.103

# Progress tracking variables (same feel as install.sh)
declare -a STEPS=(
  "Check/Install sshpass"
  "Install dependencies (local)"
  "Build project (local)"
  "Check remote connectivity"
  "Create remote temp dir"
  "Copy artifacts to remote"
  "Prepare app directory"
  "Copy temp -> appdir"
  "Install dependencies (remote, prod)"
  "Create CLI symlink"
  "Install D-Bus policy"
  "Install/configure nginx"
  "Install captive portal DNS config"
  "Install/Refresh systemd service"
  "Restart service"
)

declare -a STEP_STATUS=()
TOTAL_STEPS=${#STEPS[@]}

SYMBOL_PENDING="[ ]"
SYMBOL_BUSY="[~]"
SYMBOL_COMPLETED="[+]"
SYMBOL_SKIPPED="[-]"
SYMBOL_FAILED="[X]"

for ((i=0; i<TOTAL_STEPS; i++)); do
  STEP_STATUS[i]="$SYMBOL_PENDING"
done

show_progress() {
  clear
  echo -e "\033[1m${APPNAME} Device Software Deployment\033[0m"
  echo ""
  for ((i=0; i<TOTAL_STEPS; i++)); do
    echo -e "${STEP_STATUS[i]} ${STEPS[i]}"
  done
  echo ""
}

set_step_status() { STEP_STATUS[$1]="$2"; show_progress; }
mark_step_busy() { set_step_status "$1" "$SYMBOL_BUSY"; }
mark_step_completed() { set_step_status "$1" "$SYMBOL_COMPLETED"; }
mark_step_skipped() { set_step_status "$1" "$SYMBOL_SKIPPED"; }
mark_step_failed() { set_step_status "$1" "$SYMBOL_FAILED"; }

## Collect remote credentials (pre-step, not part of checklist)
echo -e '\e[0;33m-------------------------------------- \e[0m'
echo -e '\e[0;33m For accessing the remote device, the  \e[0m'
echo -e '\e[0;33m login credentials are required.       \e[0m'
echo -e '\e[0;33m-------------------------------------- \e[0m'
read -e -i "$DEFAULT_HOST" -p "Hostname: " HOST
HOST=${HOST:-$DEFAULT_HOST}
read -e -i "$DEFAULT_USER" -p "User: " USER
USER=${USER:-$DEFAULT_USER}

# Read password without echo; ensure we restore terminal echo
stty -echo
read -p "Password: " PASSWORD
stty echo
echo ""

REMOTE_TEMP="/tmp/edgeberry_${USER}_deploy"
SSH_BASE=(sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
SCP_BASE=(sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

##
#  Run a command as root on the device.
#
#  ssh here allocates no TTY, so sudo has no way to ask for a password and no
#  way to be given one — it exits before running anything. On a device with
#  passwordless sudo that never showed; anywhere else every privileged step
#  fails, starting with the first one ("Failed to prepare app directory").
#
#  The password already collected for sshpass is fed to 'sudo -S' on stdin
#  instead. One sudo per step rather than one per command, so the credential is
#  read once; 'bash -c' does not read stdin, so nothing else consumes it.
##
remote_sudo() {
  printf '%s\n' "$PASSWORD" | \
    "${SSH_BASE[@]}" "${USER}@${HOST}" "sudo -S -p '' bash -c $(printf '%q' "$1")"
}

# Start clean screen
show_progress

# Step 0: Check/Install sshpass
mark_step_busy 0
if which sshpass >/dev/null 2>&1; then
  mark_step_completed 0
else
  mark_step_failed 0
  echo -e "\e[0;33msshpass is required. Install with: sudo apt install -y sshpass\e[0m"
  exit 1
fi

### Local steps
# Step 1: Install dependencies (local)
mark_step_busy 1
npm install --include=dev >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 1; else mark_step_failed 1; echo -e "\e[0;33mFailed to install dependencies locally\e[0m"; exit 1; fi

# Step 2: Build project (local)
mark_step_busy 2
npm run build >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 2; else mark_step_failed 2; echo -e "\e[0;33mFailed to build project locally\e[0m"; exit 1; fi

### Remote steps
# Step 3: Check remote connectivity
mark_step_busy 3
"${SSH_BASE[@]}" ${USER}@${HOST} "true" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 3; else mark_step_failed 3; echo -e "\e[0;33mCannot connect to remote host (check host/user/password/network)\e[0m"; exit 1; fi

# Step 4: Create remote temp dir
mark_step_busy 4
"${SSH_BASE[@]}" ${USER}@${HOST} "mkdir -p \"$REMOTE_TEMP\" && rm -rf \"$REMOTE_TEMP\"/*" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 4; else mark_step_failed 4; echo -e "\e[0;33mFailed to create remote temp dir\e[0m"; exit 1; fi

# Step 5: Copy artifacts to remote
mark_step_busy 5
"${SCP_BASE[@]}" -r ./build ./public ./package.json ./scripts ./config ./share ${USER}@${HOST}:"$REMOTE_TEMP"/ >/dev/null 2>&1
SCP_STATUS=$?
if [ -f package-lock.json ]; then
  "${SCP_BASE[@]}" ./package-lock.json ${USER}@${HOST}:"$REMOTE_TEMP"/ >/dev/null 2>&1 || true
fi
# Copy .tgz files if they exist
if compgen -G "*.tgz" > /dev/null; then
  "${SCP_BASE[@]}" *.tgz ${USER}@${HOST}:"$REMOTE_TEMP"/ >/dev/null 2>&1 || true
fi
if [ $SCP_STATUS -eq 0 ]; then mark_step_completed 5; else mark_step_failed 5; echo -e "\e[0;33mFailed to copy artifacts to remote\e[0m"; exit 1; fi

# Step 6: Prepare app directory
mark_step_busy 6
# 'chown user:' rather than 'user:user': the login group is not always named
# after the user, and chown fails outright when it is not.
remote_sudo "mkdir -p '$APPDIR' '$SHAREDIR' && chown -R '$USER': '$APPDIR' '$SHAREDIR'" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 6; else mark_step_failed 6; echo -e "\e[0;33mFailed to prepare app directory\e[0m"; exit 1; fi

# What the device has installed, and what we are about to give it.
#
# Read before the rsync overwrites it, because the answer decides whether step 8
# runs at all. A deploy that changes only code — the common case — needs no npm
# work, and on a small device 'npm ci' is both the slowest thing this script does
# and the only one that can take the device down with it.
INSTALLED_LOCK=$(remote_sudo "sha256sum '$APPDIR/package-lock.json' 2>/dev/null | cut -d' ' -f1" 2>/dev/null | tr -d '[:space:]')
LOCAL_LOCK=$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1 | tr -d '[:space:]')

# Step 7: Copy temp -> appdir
mark_step_busy 7
# config/nginx/routes.d/ is excluded from --delete because it does not belong to
# this repository: it holds the route generated from the registered
# application's manifest, plus any conf an application installed itself before
# registration existed. Nothing here ships those files.
#
# A generated route would come back by itself — the Core rebuilds it from the
# manifest on start — but a hand-installed one would not, and deleting it
# silently drops that application's paths to the Device Service's catch-all.
#
# node_modules/ is on the list for the same reason: it is device-owned state,
# not repository content, so --delete saw it as extraneous and removed the whole
# installed tree on every single deploy. Rebuilding it then meant compiling
# node-pty from source under memory pressure — which is how a 512MB device ends
# up with an OOM-killed install and a Core that cannot start.
remote_sudo "rsync -a --delete --exclude 'settings.json' --exclude 'certificates/' --exclude 'share/' --exclude 'config/nginx/routes.d/' --exclude 'node_modules/' '$REMOTE_TEMP/' '$APPDIR/' && if [ -d '$REMOTE_TEMP/share' ]; then rsync -a --delete '$REMOTE_TEMP/share/' '$SHAREDIR/'; fi && rm -rf '$APPDIR/share' '$REMOTE_TEMP'" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 7; else mark_step_failed 7; echo -e "\e[0;33mFailed to copy files into app directory\e[0m"; exit 1; fi

# Step 8: Install dependencies (remote, prod only)
mark_step_busy 8

# Skipped when the lockfile is unchanged *and* the installed tree is actually
# usable. Checked rather than trusted, because those are two different
# questions: an interrupted install leaves a lockfile that matches perfectly
# and a node-pty whose pty.node was never built. 'npm ls' is happy with that —
# it counts packages, not compiled artifacts — and the device then fails on its
# next restart rather than here, where somebody is watching.
#
# Loading the native module is the check that catches it, and it makes this
# step self-healing: a device left half-installed by an earlier failed deploy
# gets repaired by the next one instead of skipped over.
DEPS_OK=false
if [ -n "$LOCAL_LOCK" ] && [ "$INSTALLED_LOCK" = "$LOCAL_LOCK" ]; then
  if remote_sudo "cd '$APPDIR' && npm ls --omit=dev --depth=0 >/dev/null 2>&1 && node -e 'require(\"node-pty\")' >/dev/null 2>&1" >/dev/null 2>&1; then
    DEPS_OK=true
  fi
fi

if $DEPS_OK; then
  mark_step_skipped 8
else
  set +e
  # 900s and JOBS=1: node-pty has no prebuilt binary for this platform, so it is
  # compiled here. The default parallel build is what exhausts memory on a small
  # device, and an OOM kill does not stop at npm — the last one took dbus-daemon
  # with it. Slower, but it finishes.
  remote_sudo "cd '$APPDIR' && timeout 900 env JOBS=1 sh -c 'if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi'" 2>&1 | grep -v "npm WARN"
  NPM_EXIT=${PIPESTATUS[0]}
  # Errexit stays off: every step below reports its own failure through
  # 'if [ $? -eq 0 ]', and aborting on the command itself skips the message.
  set +e
  if [ $NPM_EXIT -eq 0 ]; then
    mark_step_completed 8
  elif [ $NPM_EXIT -eq 124 ]; then
    mark_step_failed 8
    echo -e "\e[0;33mNPM install timed out (>900s)\e[0m"
    exit 1
  elif [ $NPM_EXIT -eq 137 ]; then
    # The kernel already wrote down what happened; say so, rather than making
    # the next person guess from "failed to install dependencies".
    mark_step_failed 8
    echo -e "\e[0;33mnpm was killed — almost certainly out of memory.\e[0m"
    echo -e "\e[0mConfirm with 'dmesg | grep -i \"out of memory\"' on the device. Adding"
    echo -e "temporary swap and re-running is usually enough on a 512MB board.\e[0m"
    echo -e "\e[0;31mThe device is now running code it cannot restart into — finish this\e[0m"
    echo -e "\e[0;31minstall before rebooting it.\e[0m"
    exit 1
  else
    mark_step_failed 8
    echo -e "\e[0;33mFailed to install production dependencies on remote\e[0m"
    exit 1
  fi
fi

# Step 9: Create CLI symlink
mark_step_busy 9
remote_sudo "ln -sf '$APPDIR/scripts/edgeberry_cli.sh' /usr/local/bin/edgeberry" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 9; else mark_step_failed 9; echo -e "\e[0;33mFailed to create CLI symlink\e[0m"; exit 1; fi

# Step 10: Install D-Bus policy
mark_step_busy 10
# 'install' rather than 'mv' — D-Bus parses this policy as root, and 'mv'
# carried the deploying user's ownership onto it (matching how the systemd
# unit is placed in step 12).
remote_sudo "if [ -f '$APPDIR/config/edgeberry-core.conf' ]; then install -m 644 -o root -g root '$APPDIR/config/edgeberry-core.conf' /etc/dbus-1/system.d/edgeberry-core.conf; elif [ -f '$APPDIR/edgeberry-core.conf' ]; then install -m 644 -o root -g root '$APPDIR/edgeberry-core.conf' /etc/dbus-1/system.d/edgeberry-core.conf; fi" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 10; else mark_step_failed 10; echo -e "\e[0;33mFailed to install D-Bus policy\e[0m"; exit 1; fi

# Step 11: Install/configure nginx as reverse proxy
mark_step_busy 11
# 'apt-get update' before the install, matching install.sh: without it apt
# resolves against whatever index is already on disk, and on a device that has
# been idle a while those entries point at package versions the mirrors have
# since replaced, so the install fails with a 404. That failure aborts the
# deploy here — after the files are already in place but before the service is
# restarted — leaving the device running stale code with no nginx at all.
# The step output is captured rather than discarded so the reason is visible.
NGINX_OUTPUT=$(remote_sudo "
  set -e
  NGINX_APPDIR='$APPDIR/config/nginx'
  if ! command -v nginx > /dev/null 2>&1; then
    apt-get update > /dev/null 2>&1
    apt-get install -y nginx > /dev/null
  fi
  mkdir -p \"\${NGINX_APPDIR}/routes.d\"
  install -m 644 \"\${NGINX_APPDIR}/edgeberry.conf\" /etc/nginx/conf.d/edgeberry.conf
  install -m 644 \"\${NGINX_APPDIR}/edgeberry\" /etc/nginx/sites-available/edgeberry
  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/edgeberry /etc/nginx/sites-enabled/edgeberry
  if nginx -t > /dev/null 2>&1; then
    systemctl enable nginx > /dev/null 2>&1
    systemctl reload nginx > /dev/null 2>&1
  else
    rm -f /etc/nginx/conf.d/edgeberry.conf /etc/nginx/sites-available/edgeberry /etc/nginx/sites-enabled/edgeberry
    nginx -t
    exit 1
  fi
" 2>&1)
if [ $? -eq 0 ]; then mark_step_completed 11; else mark_step_failed 11; echo -e "\e[0;33mFailed to install/configure nginx\e[0m"; echo "$NGINX_OUTPUT" | tail -20; exit 1; fi

# Step 12: Install captive portal DNS redirect for AP mode
mark_step_busy 12
remote_sudo "mkdir -p /etc/NetworkManager/dnsmasq-shared.d && echo 'address=/#/10.42.0.1' > /etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 12; else mark_step_failed 12; echo -e "\e[0;33mFailed to install captive portal DNS config\e[0m"; exit 1; fi

# Step 13: Install/Refresh systemd service
mark_step_busy 13
remote_sudo "if [ -f '$APPDIR/config/io.edgeberry.core.service' ]; then install -m 644 '$APPDIR/config/io.edgeberry.core.service' /etc/systemd/system/io.edgeberry.core.service; elif [ -f '$APPDIR/io.edgeberry.core.service' ]; then install -m 644 '$APPDIR/io.edgeberry.core.service' /etc/systemd/system/io.edgeberry.core.service; fi; chown root:root /etc/systemd/system/io.edgeberry.core.service; systemctl daemon-reload; systemctl enable '$SERVICENAME'" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 13; else mark_step_failed 13; echo -e "\e[0;33mFailed to install/refresh systemd service\e[0m"; exit 1; fi

# Step 14: Restart service
mark_step_busy 14
remote_sudo "systemctl restart '$SERVICENAME'" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 14; else mark_step_failed 14; echo -e "\e[0;33mFailed to restart service\e[0m"; exit 1; fi

show_progress
echo -e "\e[0;32m\033[1mDeployment completed successfully.\033[0m\e[0m"
echo ""
exit 0