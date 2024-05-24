#!/bin/bash

##
#   Install.sh
#   Installation script for the EdgeBerry application and
#   software it relies on. (npm, node, cmake, pm2, ...)
#
#   by Sanne 'SpuQ' Santens
##

APPNAME=Edgeberry
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

echo -e "Starting the \033[1m${APPNAME} Device Software\033[0m installation process..."
echo -e "Some steps can take a while with few feedback, but just have patience.\033[0m"
echo ""
echo -e "\e[0;33mNOTE: Please ensure a stable internet connecton. Some parts of\e[0m";
echo -e "\e[0;33mthe installation process are known to stall when internet is very\e[0m";
echo -e "\e[0;33mslow or connection is temporarly lost. If this happens, just retry\e[0m";
echo -e "\e[0;33mthe installation process.\e[0m";
echo ""

# Check for NodeJS. If it's not installed, install it.
echo -n -e "\e[0mChecking for NodeJS \e[0m"
if which node >/dev/null 2>&1; then 
    echo -e "\e[0;32m[Installed] \e[0m";
else 
    echo -e "\e[0;33m[Not installed] \e[0m";
    echo -n -e "\e[0mInstalling Node using apt \e[0m";
    apt install -y node > /dev/null 2>&1;
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

# Check for PM2. If it's not installed, install it.
echo -n -e "\e[0mChecking for Node Process Manager (PM2) \e[0m"
if which pm2 >/dev/null 2>&1; then 
    echo -e "\e[0;32m[Installed] \e[0m"; 
else 
    echo -e "\e[0;33m[Not installed] \e[0m";
    echo -n -e "\e[0mInstalling PM2 using npm \e[0m";
    npm install -g pm2 > /dev/null 2>&1;
    # Check if the last command succeeded
    if [ $? -eq 0 ]; then
        echo -e "\e[0;32m[Success]\e[0m"
        echo -n -e"\e[0mMaking sure PM2 runs on boot \e[0m";
        pm2 startup systemd
        if [ $? -eq 0 ]; then
            echo -e "\e[0;32m[Success]\e[0m"
        else
            echo -e "\e[0;33m[Failed]\e[0m";
        fi
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
mkdir /opt/${APPNAME}  > /dev/null 2>&1;
tar -xvzf repo.tar.gz -C /opt/${APPNAME} > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# Install package dependencies
echo -n -e "\e[0mInstalling dependencies \e[0m"
npm install --prefix /opt/${APPNAME}
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

##
#   Application UI
##

# Get the latest release of the UI
echo -n -e "\e[0mGetting latest ${APPNAME} UI release \e[0m"
latest_release=$(curl -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${REPOOWNER}/${REPONAME}-ui/releases/latest")
asset_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name | test("Edgeberry-UI-v[0-9]+\\.[0-9]+\\.[0-9]+\\.tar\\.gz")) | .url')
# If we have an asset URL, download the tarball
if [ -n "$asset_url" ]; then
    #echo -e "\e[0;32mGot URL:\e[0m ${asset_url}"; 
    echo -e "\e[0;32m[Success]\e[0m"; 
    echo -n -e "\e[0mDownloading the latest ${APPNAME} UI \e[0m"
    curl -L \
    -H "Accept: application/octet-stream" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -o "ui.tar.gz" \
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

# Unpack the UI in the build/public folder of the application
echo -n -e "\e[0mUnpacking the application \e[0m"
tar -xvzf ui.tar.gz -C /opt/${APPNAME}/build/public > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# Cleanup the download
rm -rf ui.tar.gz

##
#   Finish installation
##

# Start the application using PM2
echo -n -e "\e[0mStarting ${APPNAME} for the first time using PM2 \e[0m"
cd /opt/${APPNAME}
pm2 start npm --name ${APPNAME} -- start > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# Save the PM2 state, so the application will automatically
# run after a reboot
echo -n -e "\e[0mSaving the current PM2 state \e[0m"
pm2 save > /dev/null 2>&1
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# Exit success
echo ""
echo -e "\e[0;32m\033[1m${APPNAME} was successfully installed! \033[0m\e[0m"; 
echo ""

ip_address=$(awk '/inet / && $2 != "127.0.0.1"{print $2}' <(ifconfig))
echo -e "Access the \033[1m${APPNAME} web interface\033[0m on your local network by"
echo -e "opening a browser and going to \033[4mhttp://${ip_address}:3000\033[0m"
echo ""

# Exit success
exit 0;