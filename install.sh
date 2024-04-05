#!/bin/bash

##
#   Install.sh
#   Installation script for the EdgeBerry application and
#   software it relies on. (npm, node, cmake, pm2, ...)
#
#   by Sanne 'SpuQ' Santens
##

APPNAME=EdgeBerry


# Check if this script is running as root. If not, notify the user
# to run this script again as root and cancel the installtion process
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1;
fi

# Check for NodeJS. If it's not installed, install it.
echo -e "\e[0mChecking for NodeJS...\e[0m"
if command -v which node &>/dev/null; then 
    echo -e "\e[0;32mNodeJS is installed \e[0m"; 
else 
    echo -e "\e[0;33mNodeJS is not installed \e[0m";
    echo -e "\e[0mInstalling Node using apt \e[0m";
    apt install -y node;
fi

# Check for NPM. If it's not installed, install it.
echo -e "\e[0mChecking for Node Package Manager (NPM)...\e[0m"
if command -v which npm &>/dev/null; then 
    echo -e "\e[0;32mNPM is installed \e[0m"; 
else 
    echo -e "\e[0;33mNPM is not installed \e[0m";
    echo -e "\e[0mInstalling NPM using apt \e[0m";
    apt install -y npm;
fi

# Check for PM2. If it's not installed, install it.
echo -e "\e[0mChecking for Node Process Manager (PM2)...\e[0m"
if command -v which pm2 &>/dev/null; then 
    echo -e "\e[0;32mPM2 is installed \e[0m"; 
else 
    echo -e "\e[0;33mPM2 is not installed \e[0m";
    echo -e "\e[0mInstalling PM2 using npm \e[0m";
    npm install -g pm2;
    echo -e "\e[0mMaking sure PM2 runs on boot \e[0m";
    pm2 startup systemd
fi

# Check for CMAKE (required by AWS SDK). If it's not installed,
# install it.
echo -e "\e[0mChecking for cmake (required by AWS SDK)...\e[0m"
if command -v which cmake &>/dev/null; then 
    echo -e "\e[0;32mcmake is installed \e[0m"; 
else 
    echo -e "\e[0;33mcmake is not installed \e[0m";
    echo -e "\e[0mInstalling cmake using apt \e[0m";
    apt install -y cmake
fi

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
pm2 start npm --name ${APPNAME} -- start


# Save the PM2 state, so the application will automatically
# run after a reboot
pm2 save

# Exit success
exit 0;