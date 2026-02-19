#!/bin/bash

##
# Edgeberry Device Software Installer
# Installs the Edgeberry Core application and its prerequisites
# on Debian/Ubuntu-like systems using apt. The script is designed
# to be idempotent where possible, so re-running it is safe.
#
# Copyright (C) Edgeberry. See LICENSE.txt for details.
# Authors: Sanne 'SpuQ' Santens
#          [AI assisted since 10/08/2025]
#
# Requirements:
#   - Root privileges (run with sudo)
#   - apt package manager
#   - Internet connectivity
#
# Usage:
#   sudo ./install.sh [-y|--yes] [--dev]
#
# Options:
#   -y, --yes   Auto-confirm all prompts (non-interactive mode)
#   --dev       Install latest development build (including pre-releases)
##

APPNAME=Edgeberry
APPCOMP=Core
REPONAME=Edgeberry
REPOOWNER=Edgeberry

# Parse arguments
# -y | --yes  -> answer 'yes' to all prompts in this script
# --dev       -> install latest development build instead of stable release
ALL_YES=false
DEV_BUILD=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes)
      ALL_YES=true
      ;;
    --dev)
      DEV_BUILD=true
      ;;
  esac
done

# Progress tracking variables
declare -a STEPS=(
    "Check/Install NodeJS"
    "Check/Install NPM"
    "Check/Install CMake"
    "Check/Install JQ"
    "Get latest release info"
    "Get download URL"
    "Download application"
    "Unpack application"
    "Install dependencies"
    "Create CLI symlink"
    "Install systemd service"
    "Enable service on boot"
    "Install D-Bus policy"
    "Install captive portal DNS config"
    "Run setup (optional)"
    "Start application"
)

declare -a STEP_STATUS=()
CURRENT_STEP=0
TOTAL_STEPS=${#STEPS[@]}

# Status symbols (ASCII compatible)
SYMBOL_PENDING="[ ]"
SYMBOL_BUSY="[~]"
SYMBOL_COMPLETED="[+]"
SYMBOL_SKIPPED="[-]"
SYMBOL_FAILED="[X]"

# Initialize all steps as pending
for ((i=0; i<TOTAL_STEPS; i++)); do
    STEP_STATUS[i]="$SYMBOL_PENDING"
done

# Function to clear screen and show progress
show_progress() {
    clear
    echo -e "\033[1m    ______    _            _                      ";
    echo -e "   |  ____|  | |          | |                            ";
    echo -e "   | |__   __| | __ _  ___| |__   ___ _ __ _ __ _   _  \e[0mTM\033[1m";
    echo -e "   |  __| / _' |/ _' |/ _ \ '_ \ / _ \ '__| '__| | | |   ";
    echo -e "   | |___| (_| | (_| |  __/ |_) |  __/ |  | |  | |_| |   ";
    echo -e "   |______\__,_|\__, |\___|_.__/ \___|_|  |_|   \__, |   ";
    echo -e "                 __/ |                           __/ |   ";
    echo -e "                |___/                           |___/    \e[0m";
    echo ""
    echo -e "\033[1m${APPNAME} Device Software Installation\033[0m"
    echo ""
    
    # Show all steps with their status
    for ((i=0; i<TOTAL_STEPS; i++)); do
        echo -e "${STEP_STATUS[i]} ${STEPS[i]}"
    done
    
    echo ""
    
    # Progress bar
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

# Function to set step status
set_step_status() {
    local step_index=$1
    local status=$2
    STEP_STATUS[step_index]="$status"
    show_progress
}

# Function to mark step as busy
mark_step_busy() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_BUSY"
}

# Function to mark step as completed
mark_step_completed() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_COMPLETED"
}

# Function to mark step as skipped
mark_step_skipped() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_SKIPPED"
}

# Function to mark step as failed
mark_step_failed() {
    local step_index=$1
    set_step_status "$step_index" "$SYMBOL_FAILED"
}

# Precondition: require root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1;
fi

# Start a clean screen and show initial progress
show_progress
echo -e "Some steps can take a while with few feedback, so go grab a coffee with an";
echo -e "extra spoon of patience.\033[0m"
echo ""
echo -e "\e[0;33mNOTE: Please ensure a stable internet connection! \e[0m";
echo ""
sleep 2

# Step 0: Check for NodeJS. If it's not installed, install it.
mark_step_busy 0
if which node >/dev/null 2>&1; then 
    mark_step_skipped 0
else 
    apt install -y nodejs > /dev/null 2>&1;
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        mark_step_completed 0
    else
        mark_step_failed 0
        echo -e "\e[0;33mFailed to install NodeJS! Exit.\e[0m";
        exit 1;
    fi
fi
# If NodeJS was already installed, mark as completed
if [[ "${STEP_STATUS[0]}" == "$SYMBOL_BUSY" ]]; then
    mark_step_completed 0
fi

# Step 1: Check for NPM. If it's not installed, install it.
mark_step_busy 1
if which npm >/dev/null 2>&1; then 
    mark_step_skipped 1
else 
    apt install -y npm > /dev/null 2>&1;
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        mark_step_completed 1
    else
        mark_step_failed 1
        echo -e "\e[0;33mFailed to install NPM! Exit.\e[0m";
        exit 1;
    fi
fi
# If NPM was already installed, mark as completed
if [[ "${STEP_STATUS[1]}" == "$SYMBOL_BUSY" ]]; then
    mark_step_completed 1
fi

# Step 2: Check for CMAKE (required by AWS SDK). If it's not installed, install it.
mark_step_busy 2
if which cmake >/dev/null 2>&1; then  
    mark_step_skipped 2
else 
    apt install -y cmake > /dev/null 2>&1
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        mark_step_completed 2
    else
        mark_step_failed 2
        echo -e "\e[0;33mFailed to install CMake! Exit.\e[0m";
        exit 1;
    fi
fi
# If CMake was already installed, mark as completed
if [[ "${STEP_STATUS[2]}" == "$SYMBOL_BUSY" ]]; then
    mark_step_completed 2
fi

# Step 3: Check for JQ (required by this script). If it's not installed, install it.
mark_step_busy 3
if which jq >/dev/null 2>&1; then  
    mark_step_skipped 3
else 
    apt install -y jq > /dev/null 2>&1
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        mark_step_completed 3
    else
        mark_step_failed 3
        echo -e "\e[0;33mFailed to install JQ! Exit.\e[0m";
        exit 1;
    fi
fi
# If JQ was already installed, mark as completed
if [[ "${STEP_STATUS[3]}" == "$SYMBOL_BUSY" ]]; then
    mark_step_completed 3
fi


##
#   Application
##

# Step 4: Check for the latest release of the EdgeBerry application using the GitHub API
mark_step_busy 4
if [ "$DEV_BUILD" = true ]; then
    # For dev builds, get the latest release (including pre-releases)
    latest_release=$(curl -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${REPOOWNER}/${REPONAME}/releases" | jq '.[0]')
    echo -e "\e[0;36mInstalling latest development build...\e[0m"
else
    # For stable builds, get the latest stable release only
    latest_release=$(curl -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${REPOOWNER}/${REPONAME}/releases/latest")
    echo -e "\e[0;36mInstalling latest stable release...\e[0m"
fi
# Check if this was successful
if [ -n "$latest_release" ] && [ "$latest_release" != "null" ]; then
    # Extract and display version info
    release_tag=$(echo "$latest_release" | jq -r '.tag_name')
    release_name=$(echo "$latest_release" | jq -r '.name')
    is_prerelease=$(echo "$latest_release" | jq -r '.prerelease')
    
    if [ "$is_prerelease" = "true" ]; then
        echo -e "\e[0;33mNote: Installing pre-release version: $release_name ($release_tag)\e[0m"
    else
        echo -e "\e[0;32mInstalling stable version: $release_name ($release_tag)\e[0m"
    fi
    
    mark_step_completed 4
else
    mark_step_failed 4
    if [ "$DEV_BUILD" = true ]; then
        echo -e "\e[0;33mFailed to get latest ${APPNAME} development release info! Exit.\e[0m";
    else
        echo -e "\e[0;33mFailed to get latest ${APPNAME} release info! Exit.\e[0m";
    fi
    exit 1;
fi
# Step 5: Get the asset download URL from the release info
mark_step_busy 5
asset_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name | test("Edgeberry-v[0-9]+\\.[0-9]+\\.[0-9]+\\.tar\\.gz")) | .url')
# If we have an asset URL, proceed to download
if [ -n "$asset_url" ]; then
    mark_step_completed 5
    
    # Step 6: Download the application
    mark_step_busy 6
    curl -L \
    -H "Accept: application/octet-stream" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -o "repo.tar.gz" \
    "$asset_url" > /dev/null 2>&1
    # Check if the download was successful
    if [ $? -eq 0 ]; then
        mark_step_completed 6
    else
        mark_step_failed 6
        echo -e "\e[0;33mFailed to download application! Exit.\e[0m";
        exit 1;
    fi
else
    mark_step_failed 5
    echo -e "\e[0;33mFailed to get download URL! Exit.\e[0m";
    exit 1;
fi

# Step 7: Untar the application in the application folder
mark_step_busy 7
mkdir -p /opt/${APPNAME}/${APPCOMP}  > /dev/null 2>&1;
tar -xvzf repo.tar.gz -C /opt/${APPNAME}/${APPCOMP} > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    mark_step_completed 7
else
    mark_step_failed 7
    echo -e "\e[0;33mFailed to unpack application! Exit.\e[0m";
    exit 1;
fi

# Step 8: Install package dependencies
mark_step_busy 8
npm install --prefix /opt/${APPNAME}/${APPCOMP} > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    mark_step_completed 8
else
    mark_step_failed 8
    echo -e "\e[0;33mFailed to install dependencies! Exit.\e[0m";
    exit 1;
fi

# Cleanup the download
rm -rf repo.tar.gz

# Step 9: Create the symlink to the application's CLI script
mark_step_busy 9
cd /opt/${APPNAME}/${APPCOMP}
# Ensure CLI script is executable and create symlink to it on PATH
chmod +x /opt/${APPNAME}/${APPCOMP}/scripts/edgeberry_cli.sh
ln -sf /opt/${APPNAME}/${APPCOMP}/scripts/edgeberry_cli.sh /usr/local/bin/edgeberry
if [ $? -eq 0 ]; then
    mark_step_completed 9
else
    mark_step_failed 9
    echo -e "\e[0;33mFailed to create CLI symlink!\e[0m";
fi

# Step 10: Install the Edgeberry systemd service
mark_step_busy 10
mv -f /opt/${APPNAME}/${APPCOMP}/config/io.edgeberry.core.service /etc/systemd/system/
systemctl daemon-reload
if [ $? -eq 0 ]; then
    mark_step_completed 10
else
    mark_step_failed 10
    echo -e "\e[0;33mFailed to install systemd service!\e[0m";
fi
# Step 11: Enable the Edgeberry service to run on boot
mark_step_busy 11
systemctl enable io.edgeberry.core
if [ $? -eq 0 ]; then
    mark_step_completed 11
else
    mark_step_failed 11
    echo -e "\e[0;33mFailed to enable service on boot!\e[0m";
fi

# Step 12: Move the dbus policy to the /etc/dbus-1/system.d directory
mark_step_busy 12
mv -f /opt/${APPNAME}/${APPCOMP}/config/edgeberry-core.conf /etc/dbus-1/system.d/
if [ $? -eq 0 ]; then
    mark_step_completed 12
else
    mark_step_failed 12
    echo -e "\e[0;33mFailed to install D-Bus policy!\e[0m";
fi

# Step 13: Install captive portal DNS redirect for AP mode.
# When the device runs as an access point, dnsmasq (started by
# NetworkManager's shared mode) must resolve ALL DNS queries to
# the device IP so that phones/laptops detect the captive portal.
mark_step_busy 13
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
echo 'address=/#/10.42.0.1' > /etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf
if [ $? -eq 0 ]; then
    mark_step_completed 13
else
    mark_step_failed 13
    echo -e "\e[0;33mFailed to install captive portal DNS config!\e[0m";
fi

# Step 14: Prompt the user to run the setup script
mark_step_busy 14
if $ALL_YES; then
    response="Y"
else
    read -r -p "Run setup? [Y/n]: " response
fi
case "$response" in
    [nN])
        mark_step_skipped 14
        ;;
    *) 
        bash ./scripts/setup.sh
        if [ $? -eq 0 ]; then
            mark_step_completed 14
        else
            mark_step_failed 14
            echo -e "\e[0;33mSetup script failed!\e[0m";
        fi
        ;;
esac

##
#   Finish installation
##

# Step 15: Start the application for the first time
mark_step_busy 15
systemctl start io.edgeberry.core
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    mark_step_completed 15
else
    mark_step_failed 15
    echo -e "\e[0;33mFailed to start ${APPNAME}! Exit.\e[0m";
    exit 1;
fi

# Final progress display
show_progress

# We're done. Some notes before we're leaving.
echo ""
echo -e "\e[0;32m\033[1mThe ${APPNAME} Device Software was successfully installed! \033[0m\e[0m"; 
echo ""

# Suggest the user to connect the device to the Edgeberry Dashboard
DEVICE_ID=$(edgeberry --hardware-id)
echo -e "To connect this device to your Edgeberry Dashboard,"
echo -e "go to \e[0;32mhttps://dashboard.edgeberry.io\e[0m, and add"
echo -e "the device with its Hardware ID: \e[0;32m${DEVICE_ID}\e[0m"
echo ""

# Exit success
exit 0;