#!/bin/bash

#   deploy.sh
#   Deploy the Edge Gateway application to a device on your
#   local network using SSH.

clear;

# Check whether sshpass is installed
if [[ -z $(which sshpass) ]]; then
    echo "install sshpass to continue. (sudo apt install sshpass)"
    exit 1;
fi

# Remote access credentials
echo 'Remote access'
read -p "Host: " HOST
if [[ -z "$HOST" ]]; then
    HOST=192.168.1.103
fi

read -p "User: " USER
if [[ -z "$USER" ]]; then
    USER=spuq
fi

read -p "Password: " PASSWORD
if [[ -z "$PASSWORD" ]]; then
    PASSWORD=32bjfewAQZpd80x
fi

# Create a directory on the device for copying the project to
echo "Creating a directory for copying the project to"
sshpass -p ${PASSWORD} ssh ${USER}@${HOST} "mkdir ~/temp"


# Copy project to the device
sshpass -p ${PASSWORD} scp -r . ${USER}@${HOST}:temp/

# Todo: installation steps on remote device (as root)

exit 0;