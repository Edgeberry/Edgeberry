#!/bin/bash

##
#   Install.sh
#   Installation script for the EdgeBerry application and
#   software it relies on. (npm, node, cmake, pm2, ...)
#
#   by Sanne 'SpuQ' Santens
##

APPNAME=EdgeBerry
REPONAME=EdgeBerry
REPOOWNER=SpuQ
ACCESSTOKEN=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


# Check if this script is running as root. If not, notify the user
# to run this script again as root and cancel the installtion process
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1;
fi

# Check for NodeJS. If it's not installed, install it.
echo -e "\e[0mChecking for NodeJS...\e[0m"
if which node >/dev/null 2>&1; then 
    echo -e "\e[0;32mNodeJS is installed \e[0m"; 
else 
    echo -e "\e[0;33mNodeJS is not installed \e[0m";
    echo -e "\e[0mInstalling Node using apt \e[0m";
    apt install -y node;
fi

# Check for NPM. If it's not installed, install it.
echo -e "\e[0mChecking for Node Package Manager (NPM)...\e[0m"
if which npm >/dev/null 2>&1; then 
    echo -e "\e[0;32mNPM is installed \e[0m"; 
else 
    echo -e "\e[0;33mNPM is not installed \e[0m";
    echo -e "\e[0mInstalling NPM using apt \e[0m";
    apt install -y npm;
fi

# Check for PM2. If it's not installed, install it.
echo -e "\e[0mChecking for Node Process Manager (PM2)...\e[0m"
if which pm2 >/dev/null 2>&1; then 
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
if which cmake >/dev/null 2>&1; then  
    echo -e "\e[0;32mcmake is installed \e[0m"; 
else 
    echo -e "\e[0;33mcmake is not installed \e[0m";
    echo -e "\e[0mInstalling cmake using apt \e[0m";
    apt install -y cmake
fi


##
#   Application
##

# Check for the latest release of the EdgeBerry application using the
# GitHub API
echo -e "\e[0mGetting latest release of the ${APPNAME} Application \e[0m"
latest_release=$(curl -H "Authorization: token ${ACCESSTOKEN}" -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${REPOOWNER}/${REPONAME}/releases/latest")
asset_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name | test("EdgeBerry-v[0-9]+\\.[0-9]+\\.[0-9]+\\.tar\\.gz")) | .url')
echo -e "\e[0;32mGot download URL:\e[0m ${asset_url}"; 
# If we have an asset URL, download the tarball
if [ -n "$asset_url" ]; then
    echo -e "\e[0mDownloading the application...\e[0m"
    curl -L \
    -H "Accept: application/octet-stream" \
    -H "Authorization: Bearer ${ACCESSTOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -o "repo.tar.gz" \
    "$asset_url"
else
    echo -e "\e[0;33mFailed to get the latest release URL\e[0m";
    exit 1;
fi

#Untar the application in the application folder
echo -e "\e[0mUnpacking the application in the application folder...\e[0m"
mkdir /opt/${APPNAME}
tar -xvzf repo.tar.gz -C /opt/${APPNAME}

# Install package dependencies
echo -e "\e[0mInstalling dependencies...\e[0m"
npm install --prefix /opt/${APPNAME}

# Cleanup the download
rm -rf repo.tar.gz

##
#   Application UI
##

# Get the latest release of the UI
echo -e "\e[0mGetting latest release of the ${APPNAME} UI \e[0m"
latest_release=$(curl -H "Authorization: token ${ACCESSTOKEN}" -H "Accept: application/vnd.github.v3+json" -s "https://api.github.com/repos/${REPOOWNER}/${REPONAME}-ui/releases/latest")
asset_url=$(echo "$latest_release" | jq -r '.assets[] | select(.name | test("EdgeBerry-UI-v[0-9]+\\.[0-9]+\\.[0-9]+\\.tar\\.gz")) | .url')
echo -e "\e[0;32mGot download URL:\e[0m ${asset_url}"; 
# If we have an asset URL, download the tarball
if [ -n "$asset_url" ]; then
    echo -e "\e[0mDownloading the user interface...\e[0m"
    curl -L \
    -H "Accept: application/octet-stream" \
    -H "Authorization: Bearer ${ACCESSTOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -o "ui.tar.gz" \
    "$asset_url"
else
    echo -e "\e[0;33mFailed to get the latest UI release URL\e[0m";
    exit 1;
fi

# Unpack the UI in the build/public folder of the application
echo -e "\e[0mUnpacking the application in the application UI folder...\e[0m"
tar -xvzf ui.tar.gz -C /opt/${APPNAME}/build/public

# Cleanup the download
rm -rf ui.tar.gz

##
#   Finish installation
##

# Start the application using PM2
cd /opt/${APPNAME}
pm2 start build/index.js  --name ${APPNAME}

# Save the PM2 state, so the application will automatically
# run after a reboot
pm2 save

# Exit success
exit 0;