#!/bin/bash

##
# Edgeberry Device Software Uninstaller
# Removes the Edgeberry Core application and related artifacts
# from Debian/Ubuntu-like systems.
#
# Authors: Sanne 'SpuQ' Santens
#          [AI assisted since 12/08/2025]
#
# Usage:
#   sudo ./uninstall.sh [-y|--yes]
#
# Options:
#   -y, --yes   Auto-confirm all prompts (non-interactive mode)
##

APPNAME=Edgeberry
APPCOMP=Core

# Parse arguments
ALL_YES=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes)
      ALL_YES=true
      ;;
  esac
done

# Progress tracking variables (aligned with install.sh style)
declare -a STEPS=(
    "Confirm uninstall"
    "Stop service"
    "Disable service on boot"
    "Remove systemd service file"
    "Reload systemd"
    "Remove D-Bus policy"
    "Remove CLI symlink"
    "Remove application directory"
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
    echo -e "\033[1m    ______    _            _                      "
    echo -e "   |  ____|  | |          | |                            "
    echo -e "   | |__   __| | __ _  ___| |__   ___ _ __ _ __ _   _  \e[0mTM\033[1m"
    echo -e "   |  __| / _' |/ _' |/ _ \ '_ \ / _ \ '__| '__| | | |   "
    echo -e "   | |___| (_| | (_| |  __/ |_) |  __/ |  | |  | |_| |   "
    echo -e "   |______\__,_|\__, |\___|_.__/ \___|_|  |_|   \__, |   "
    echo -e "                 __/ |                           __/ |   "
    echo -e "                |___/                           |___/    \e[0m"
    echo ""
    echo -e "\033[1m${APPNAME} Device Software Uninstallation\033[0m"
    echo ""

    for ((i=0; i<TOTAL_STEPS; i++)); do
        echo -e "${STEP_STATUS[i]} ${STEPS[i]}"
    done

    echo ""

    local completed=0
    for status in "${STEP_STATUS[@]}"; do
        if [[ "$status" == "$SYMBOL_COMPLETED" || "$status" == "$SYMBOL_SKIPPED" ]]; then
            ((completed++))
        fi
    done

    local progress=$((completed * 100 / TOTAL_STEPS))
    local bar_length=50
    local filled_length=$((completed * bar_length / TOTAL_STEPS))

    printf "Progress: ["
    for ((i=0; i<bar_length; i++)); do
        if [ $i -lt $filled_length ]; then
            printf "="
        else
            printf " "
        fi
    done
    printf "] %d%% (%d/%d)\n" "$progress" "$completed" "$TOTAL_STEPS"
    echo ""
}

set_step_status() {
    local step_index=$1
    local status=$2
    STEP_STATUS[step_index]="$status"
    show_progress
}

mark_step_busy() { set_step_status "$1" "$SYMBOL_BUSY"; }
mark_step_completed() { set_step_status "$1" "$SYMBOL_COMPLETED"; }
mark_step_skipped() { set_step_status "$1" "$SYMBOL_SKIPPED"; }
mark_step_failed() { set_step_status "$1" "$SYMBOL_FAILED"; }

# Root requirement
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1
fi

# Initial screen
show_progress
echo -e "Uninstall will remove ${APPNAME} ${APPCOMP} and related artifacts."
echo ""
sleep 1

# Step 0: Confirm uninstall
mark_step_busy 0
if $ALL_YES; then
    response="y"
else
    read -r -p "Delete ${APPNAME} device software? [y/N]: " response
fi
case "$response" in
    [yY])
        mark_step_completed 0
        ;;
    *)
        mark_step_skipped 0
        echo -e "\e[0;33mUninstall cancelled by user.\e[0m"
        exit 0
        ;;
esac

# Step 1: Stop service
mark_step_busy 1
if systemctl list-units --type=service --all | grep -q "io.edgeberry.core.service"; then
    systemctl stop io.edgeberry.core >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        mark_step_completed 1
    else
        mark_step_failed 1
    fi
else
    mark_step_skipped 1
fi

# Step 2: Disable service on boot
mark_step_busy 2
if systemctl list-unit-files | grep -q "io.edgeberry.core.service"; then
    systemctl disable io.edgeberry.core >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        mark_step_completed 2
    else
        mark_step_failed 2
    fi
else
    mark_step_skipped 2
fi

# Step 3: Remove systemd service file
mark_step_busy 3
if [ -f "/etc/systemd/system/io.edgeberry.core.service" ]; then
    rm -f /etc/systemd/system/io.edgeberry.core.service
    if [ $? -eq 0 ]; then
        mark_step_completed 3
    else
        mark_step_failed 3
    fi
else
    mark_step_skipped 3
fi

# Step 4: Reload systemd
mark_step_busy 4
systemctl daemon-reload >/dev/null 2>&1
if [ $? -eq 0 ]; then
    mark_step_completed 4
else
    mark_step_failed 4
fi

# Step 5: Remove D-Bus policy
mark_step_busy 5
if [ -f "/etc/dbus-1/system.d/edgeberry-core.conf" ]; then
    rm -f /etc/dbus-1/system.d/edgeberry-core.conf
    if [ $? -eq 0 ]; then
        mark_step_completed 5
    else
        mark_step_failed 5
    fi
else
    mark_step_skipped 5
fi

# Step 6: Remove CLI symlink
mark_step_busy 6
if [ -L "/usr/local/bin/edgeberry" ] || [ -f "/usr/local/bin/edgeberry" ]; then
    rm -f /usr/local/bin/edgeberry
    if [ $? -eq 0 ]; then
        mark_step_completed 6
    else
        mark_step_failed 6
    fi
else
    mark_step_skipped 6
fi

# Step 7: Remove application directory
mark_step_busy 7
if [ -d "/opt/${APPNAME}/${APPCOMP}" ] || [ -d "/opt/${APPNAME}" ]; then
    rm -rf "/opt/${APPNAME}"
    if [ $? -eq 0 ]; then
        mark_step_completed 7
    else
        mark_step_failed 7
    fi
else
    mark_step_skipped 7
fi

echo ""
echo -e "\e[0;32m${APPNAME} ${APPCOMP} uninstallation completed.\e[0m"
exit 0