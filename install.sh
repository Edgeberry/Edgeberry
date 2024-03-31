#!/bin/bash

##
#   Install.sh
#   Installation script for the Edge Gateway application and
#   software it relies.
#
#   by Sanne 'SpuQ' Santens
##

APPNAME="Edge Gateway"


# Check if this script is running as root. If not, notify the user
# to run this script again as root and cancel the installtion process
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1;
fi

# Check for NodeJS. If it's not installed, ask the user to proceed
# with installing NodeJS. If user says no, cancel installation
# process.
echo -e "\e[0mChecking for NodeJS...\e[0m"
if command -v node &>/dev/null; then 
    echo -e "\e[0;32mNodeJS is installed \e[0m"; 
else 
    echo "\e[0;33mNodeJS is not installed \e[0m";
    
fi

# Check for NPM. If it's not installed, ask the user to proceed with
# installing NPM. If user says no, cancel installation process.
echo -e "\e[0mChecking for Node Package Manager (NPM)...\e[0m"


# Check for PM2. If it's not installed, ask the user to proceed with
# installing PM2. If user says no, cancel installation process.
echo -e "\e[0mChecking for Node Process Manager (PM2)...\e[0m"


# Check for the latest release of the application using the GitHub
# API.
echo -e "\e[0mGetting latest release of the ${APPNAME} Application \e[0m"


# Download the latest release tarball.


# Create the directory for this application, and unpack the tarball
# there.


# Install the application dependencies using NPM


# Ask the user whether they want the application UI to be installed.
# If not, skip the steps for installing the UI.


# UI: Check for the latest release of the application's UI using the
# GitHub API
echo -e "\e[0mGetting latest release of the ${APPNAME} UI \e[0m"


# UI: Download the latest release tarball


# Unpack the tarball in the 'public' folder of the application


# Start the application using PM2


# Save the PM2 state, so the application will automatically
# run after a reboot

# Exit success
exit 0;