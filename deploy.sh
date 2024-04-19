#!/bin/bash

#   deploy.sh
#   Deploy the EdgeBerry application to a device on your
#   local network using sshpass.

DEFAULT_USER=spuq
DEFAULT_HOST=192.168.1.105
APPDIR=/opt/EdgeBerry

clear;

# Check whether sshpass is installed
if [[ -z $(which sshpass) ]]; then
    echo "install sshpass to continue. (sudo apt install sshpass)"
    exit 1;
fi

# Remote access credentials
echo -e '\e[0;33m-------------------------------------- \e[m'
echo -e '\e[0;33m For accessing the remote device, the  \e[m'
echo -e '\e[0;33m login credentials are required.       \e[m'
echo -e '\e[0;33m-------------------------------------- \e[m'

read -p "Host ($DEFAULT_HOST): " HOST
if [[ -z "$HOST" ]]; then
    HOST=$DEFAULT_HOST
fi

read -p "User ($DEFAULT_USER): " USER
if [[ -z "$USER" ]]; then
    USER=$DEFAULT_USER
fi

stty -echo
read -p "Password: " PASSWORD
stty -echo
echo ''
echo ''

# Create a directory on the device for copying the project to
echo -e '\e[0;32mCreating temporary directory for the project... \e[m'
sshpass -p ${PASSWORD} ssh -o StrictHostKeyChecking=no ${USER}@${HOST} "mkdir ~/temp"


# Copy project to the device
echo -e '\e[0;32mCopying project to device...\e[m'
sshpass -p ${PASSWORD} scp -r ./src ./package.json ./tsconfig.json ./webpack.config.js ${USER}@${HOST}:temp/

# Install the application on remote device
sshpass -p ${PASSWORD} ssh -o StrictHostKeyChecking=no ${USER}@${HOST} << EOF 

    sudo su
    echo -e '\e[0;32mCreating project directory... \e[m'
    mkdir /opt/EdgeBerry

    echo -e '\e[0;32mCopying project to project directory... \e[m'
    cp -r ./temp/* /opt/EdgeBerry
    rm -rf ./temp

    echo -e '\e[0;32mInstalling project dependencies... \e[m'
    cd /opt/EdgeBerry
    npm install --include=dev --verbose

    echo -e '\e[0;32mBuilding the project... \e[m'
    npm run build --verbose

    # (re)start application
    echo -e '\e[0;32mRestarting the application... \e[m'
    pm2 restart EdgeBerry
    
EOF

exit 0;