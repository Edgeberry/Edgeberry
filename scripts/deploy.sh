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
"${SCP_BASE[@]}" -r ./build ./package.json ./scripts ./config ${USER}@${HOST}:"$REMOTE_TEMP"/ >/dev/null 2>&1
SCP_STATUS=$?
if [ -f package-lock.json ]; then
  "${SCP_BASE[@]}" ./package-lock.json ${USER}@${HOST}:"$REMOTE_TEMP"/ >/dev/null 2>&1 || true
fi
if [ $SCP_STATUS -eq 0 ]; then mark_step_completed 5; else mark_step_failed 5; echo -e "\e[0;33mFailed to copy artifacts to remote\e[0m"; exit 1; fi

# Step 6: Prepare app directory
mark_step_busy 6
"${SSH_BASE[@]}" ${USER}@${HOST} "sudo mkdir -p \"$APPDIR\" && sudo chown -R \"$USER\":\"$USER\" \"$APPDIR\"" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 6; else mark_step_failed 6; echo -e "\e[0;33mFailed to prepare app directory\e[0m"; exit 1; fi

# Step 7: Copy temp -> appdir
mark_step_busy 7
"${SSH_BASE[@]}" ${USER}@${HOST} "sudo rsync -a --delete --exclude 'settings.json' --exclude 'certificates/' \"$REMOTE_TEMP/\" \"$APPDIR/\" && rm -rf \"$REMOTE_TEMP\"" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 7; else mark_step_failed 7; echo -e "\e[0;33mFailed to copy files into app directory\e[0m"; exit 1; fi

# Step 8: Install dependencies (remote, prod only)
mark_step_busy 8
set +e
"${SSH_BASE[@]}" ${USER}@${HOST} "cd \"$APPDIR\" && timeout 120 bash -c 'if [ -f package-lock.json ]; then sudo npm ci --omit=dev; else sudo npm install --omit=dev; fi'" 2>&1 | grep -v "npm WARN"
NPM_EXIT=${PIPESTATUS[0]}
set -e
if [ $NPM_EXIT -eq 0 ]; then mark_step_completed 8; elif [ $NPM_EXIT -eq 124 ]; then mark_step_failed 8; echo -e "\e[0;33mNPM install timed out (>120s)\e[0m"; exit 1; else mark_step_failed 8; echo -e "\e[0;33mFailed to install production dependencies on remote\e[0m"; exit 1; fi

# Step 9: Create CLI symlink
mark_step_busy 9
"${SSH_BASE[@]}" ${USER}@${HOST} "sudo ln -sf \"$APPDIR/scripts/edgeberry_cli.sh\" /usr/local/bin/edgeberry" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 9; else mark_step_failed 9; echo -e "\e[0;33mFailed to create CLI symlink\e[0m"; exit 1; fi

# Step 10: Install D-Bus policy
mark_step_busy 10
"${SSH_BASE[@]}" ${USER}@${HOST} "if [ -f \"$APPDIR/config/edgeberry-core.conf\" ]; then sudo mv -f \"$APPDIR/config/edgeberry-core.conf\" /etc/dbus-1/system.d/; elif [ -f \"$APPDIR/edgeberry-core.conf\" ]; then sudo mv -f \"$APPDIR/edgeberry-core.conf\" /etc/dbus-1/system.d/; fi" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 10; else mark_step_failed 10; echo -e "\e[0;33mFailed to install D-Bus policy\e[0m"; exit 1; fi

# Step 11: Install/Refresh systemd service
mark_step_busy 11
"${SSH_BASE[@]}" ${USER}@${HOST} "if [ -f \"$APPDIR/config/io.edgeberry.core.service\" ]; then sudo install -m 644 \"$APPDIR/config/io.edgeberry.core.service\" /etc/systemd/system/io.edgeberry.core.service; elif [ -f \"$APPDIR/io.edgeberry.core.service\" ]; then sudo install -m 644 \"$APPDIR/io.edgeberry.core.service\" /etc/systemd/system/io.edgeberry.core.service; fi; sudo chown root:root /etc/systemd/system/io.edgeberry.core.service; sudo systemctl daemon-reload; sudo systemctl enable \"$SERVICENAME\"" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 11; else mark_step_failed 11; echo -e "\e[0;33mFailed to install/refresh systemd service\e[0m"; exit 1; fi

# Step 12: Restart service
mark_step_busy 12
"${SSH_BASE[@]}" ${USER}@${HOST} "sudo systemctl restart \"$SERVICENAME\"" >/dev/null 2>&1
if [ $? -eq 0 ]; then mark_step_completed 12; else mark_step_failed 12; echo -e "\e[0;33mFailed to restart service\e[0m"; exit 1; fi

show_progress
echo -e "\e[0;32m\033[1mDeployment completed successfully.\033[0m\e[0m"
echo ""
exit 0