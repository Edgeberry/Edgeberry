#!/bin/bash

##
#   Install.sh
#   Installation script for the Edgeberry device software and
#   the software it relies on. (npm, node, cmake, ...)
#
#   by Sanne 'SpuQ' Santens
##

APPNAME=Edgeberry
APPCOMP=Core
REPONAME=Edgeberry
REPOOWNER=Edgeberry

# Start a clean screen
clear;

# Check if this script is running as root. If not, notify the user
# to run this script again as root and cancel the installtion process
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1;
fi

echo -e "\033[1m    ______    _            _                      ";
echo -e "   |  ____|  | |          | |                            ";
echo -e "   | |__   __| | __ _  ___| |__   ___ _ __ _ __ _   _  \e[0mTM\033[1m";
echo -e "   |  __| / _' |/ _' |/ _ \ '_ \ / _ \ '__| '__| | | |   ";
echo -e "   | |___| (_| | (_| |  __/ |_) |  __/ |  | |  | |_| |   ";
echo -e "   |______\__,_|\__, |\___|_.__/ \___|_|  |_|   \__, |   ";
echo -e "                 __/ |                           __/ |   ";
echo -e "                |___/                           |___/    \e[0m";
echo ""
echo -e "Starting the \033[1m${APPNAME} Device Software\033[0m installation process...";
echo -e "Some steps can take a while with few feedback, so go grab a coffee with an";
echo -e "extra spoon of patience.\033[0m"
echo ""
echo -e "\e[0;33mNOTE: Please ensure a stable internet connection! \e[0m";
echo ""

# Check for NodeJS. If it's not installed, install it.
echo -n -e "\e[0mChecking for NodeJS \e[0m"
if which node >/dev/null 2>&1; then 
    echo -e "\e[0;32m[Installed] \e[0m";
else 
    echo -e "\e[0;33m[Not installed] \e[0m";
    echo -n -e "\e[0mInstalling Node using apt \e[0m";
    apt install -y nodejs > /dev/null 2>&1;
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        echo -e "\e[0;32m[Success]\e[0m"
    else
        echo -e "\e[0;33mFailed! Exit.\e[0m";
        exit 1;
    fi
fi

# Check for NPM. If it's not installed, install it.
echo -n -e "\e[0mChecking for Node Package Manager (NPM) \e[0m"
if which npm >/dev/null 2>&1; then 
    echo -e "\e[0;32m[Installed] \e[0m"; 
else 
    echo -e "\e[0;33m[Not installed] \e[0m";
    echo -n -e "\e[0mInstalling NPM using apt \e[0m";
    apt install -y npm > /dev/null 2>&1;
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        echo -e "\e[0;32m[Success]\e[0m"
    else
        echo -e "\e[0;33mFailed! Exit.\e[0m";
        exit 1;
    fi
fi

# Check for CMAKE (required by AWS SDK). If it's not installed,
# install it.
echo -n -e "\e[0mChecking for cmake \e[0m"
if which cmake >/dev/null 2>&1; then  
    echo -e "\e[0;32m[Installed] \e[0m"; 
else 
    echo -e "\e[0;33m[Not installed] \e[0m";
    echo -n -e "\e[0mInstalling cmake using apt \e[0m";
    apt install -y cmake > /dev/null 2>&1
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        echo -e "\e[0;32m[Success]\e[0m"
    else
        echo -e "\e[0;33mFailed! Exit.\e[0m";
        exit 1;
    fi
fi

# Check for JQ (required by this script). If it's not installed,
# install it.
echo -n -e "\e[0mChecking for jq \e[0m"
if which jq >/dev/null 2>&1; then  
    echo -e "\e[0;32m[Installed] \e[0m"; 
else 
    echo -e "\e[0;33m[Not installed] \e[0m";
    echo -n -e "\e[0mInstalling jq using apt \e[0m";
    apt install -y jq > /dev/null 2>&1
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        echo -e "\e[0;32m[Success]\e[0m"
    else
        echo -e "\e[0;33mFailed! Exit.\e[0m";
        exit 1;
    fi
fi


##
#   Application
##

# Check for the latest release of the EdgeBerry application using the
# GitHub API
echo -n -e "\e[0mGetting latest ${APPNAME} release info \e[0m"
latest_release=$(curl -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${REPOOWNER}/${REPONAME}/releases/latest")
# Check if this was successful
if [ -n "$latest_release" ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed to get latest ${APPNAME} release info! Exit.\e[0m";
    exit 1;
fi
# Get the asset download URL from the release info
echo -n -e "\e[0mGetting the latest ${APPNAME} release download URL \e[0m"
asset_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name | test("Edgeberry-v[0-9]+\\.[0-9]+\\.[0-9]+\\.tar\\.gz")) | .url')
# If we have an asset URL, download the tarball
if [ -n "$asset_url" ]; then
    #echo -e "\e[0;32mURL:\e[0m ${asset_url}";
    echo -e "\e[0;32m[Success]\e[0m"; 
    echo -n -e "\e[0mDownloading the application \e[0m"
    curl -L \
    -H "Accept: application/octet-stream" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -o "repo.tar.gz" \
    "$asset_url" > /dev/null 2>&1
    # Check if the download was successful
    if [ $? -eq 0 ]; then
        echo -e "\e[0;32m[Success]\e[0m"
    else
        echo -e "\e[0;33mFailed! Exit.\e[0m";
        exit 1;
    fi
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

#Untar the application in the application folder
echo -n -e "\e[0mUnpacking the application \e[0m"
mkdir -p /opt/${APPNAME}/${APPCOMP}  > /dev/null 2>&1;
tar -xvzf repo.tar.gz -C /opt/${APPNAME}/${APPCOMP} > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# Install package dependencies
echo -n -e "\e[0mInstalling dependencies \e[0m"
npm install --prefix /opt/${APPNAME}/${APPCOMP}
# > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# Cleanup the download
rm -rf repo.tar.gz

# Create the symlink to the application's CLI script
cd /opt/${APPNAME}/${APPCOMP}
echo -e '\e[0;32mCreating CLI symlink... \e[m'
ln -sf $(pwd)/edgeberry_cli.sh /usr/local/bin/edgeberry

# Install the Edgeberry systemd service
echo -e -n '\e[0;32mInstalling systemd service... \e[m'
mv -f /opt/${APPNAME}/${APPCOMP}/io.edgeberry.core.service /etc/systemd/system/
systemctl daemon-reload
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33m[Failed]\e[0m";
fi
# Enable the Edgeberry service to run on boot
echo -e -n '\e[0;32mEnabling service to run on boot... \e[m'
systemctl enable io.edgeberry.core
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33m[Failed]\e[0m";
fi

# Move the dbus policy to the /etc/dbus-1/system.d directory
echo -e '\e[0;32mInstalling D-Bus policy... \e[m'
mv -f /opt/${APPNAME}/${APPCOMP}/edgeberry-core.conf /etc/dbus-1/system.d/

# Prompt the user to run the setup script
read -r -p "Run setup? [Y/n]: " response
case "$response" in
    [nN])
        ;;
    *) 
        bash ./setup.sh
        ;;
esac

##
#   Finish installation
##

# Start the application using PM2
echo -n -e "\e[0mStarting ${APPNAME} for the first time... \e[0m"
systemctl start io.edgeberry.core
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# We're done. Some notes before
# we're leaving.
echo ""
echo -e "\e[0;32m\033[1m${APPNAME} was successfully installed! \033[0m\e[0m"; 
echo ""

# Exit success
exit 0;