#!/bin/bash

##
#   setup.sh
#   Setup the variables required for using the
#   Edgeberry device software.
#
#   by Sanne 'SpuQ' Santens
##

APPNAME=Edgeberry
CERTDIR=/opt/$APPNAME/certificates
SETTINGSFILE=/opt/$APPNAME/settings.json
HWIDFILE=/proc/device-tree/hat/uuid

# Start a clean screen
clear;

# Check if this script is running as root. If not, notify the user
# to run this script again as root and cancel the setup process
if [ "$EUID" -ne 0 ]; then
    echo -e "\e[0;31mUser is not root. Exit.\e[0m"
    echo -e "\e[0mRun this script again as root\e[0m"
    exit 1;
fi

echo -e "Starting the \033[1m${APPNAME} Device Software\033[0m setup..."
echo -e "Some steps can take a while with few feedback, but just have patience.\033[0m"
echo ""

# Create the certificates directory and all
# required files
echo -e "\e[0mCreating the certificates directory and content... \e[0m"
mkdir -p $CERTDIR
touch $CERTDIR/provisioning_cert.pem
touch $CERTDIR/provisioning_key.pem
touch $CERTDIR/provisioning_rootCA.pem

read -p "Hostname: " HOSTNAME
if [[ -z "$HOSTNAME" ]]; then
    echo -e "\e[0;31mHostname cannot be empty\e[0m"
    echo -e "\e[0mExit\e[0m"
    exit 1;
fi

# Populate the provisioning certificate file
echo -e "\e[0mPopulating the provisioning certificate file...\e[0m"
nano $CERTDIR/provisioning_cert.pem
# Populate the provisioning private key file
echo -e "\e[0mPopulating the provisioning private key...\e[0m"
nano $CERTDIR/provisioning_key.pem

# Get the UUID from the EEPROM of the device - if it's not
# present, generate a clientId
echo -e "\e[0mChecking Edgeberry Hardware UUID... \e[0m"
if [ -f $HWIDFILE ]; then
    echo -e "\e[0mHardware UUID found\e[0m"
    UUID=$(cat $HWIDFILE)
else
    echo -e "\e[0mHardware UUID not found\e[0m"
    echo -e "\e[0mGenerating a random ID\e[0m"
    UUID=Edgeberry_$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 32)
fi


# Create the settings file
echo -e "\e[0mCreating the settings file...\e[0m"
touch $SETTINGSFILE
echo "{
    \"provisioning\": {
        \"hostName\": \"$HOSTNAME\",
        \"clientId\": \"$UUID\",
        \"certificateFile\": \"certificates/provisioning_cert.pem\",
        \"privateKeyFile\": \"certificates/provisioning_key.pem\",
        \"rootCertificateFile\": \"certificates/provisioning_rootCA.pem\"
    }
}" > $SETTINGSFILE
# Check the settings file
nano $SETTINGSFILE

# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi

# Exit success
exit 0;