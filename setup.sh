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
echo -e -n "\e[0mCreating the certificates directory and content... \e[0m"
mkdir -p $CERTDIR
# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33mFailed! Exit.\e[0m";
    exit 1;
fi
touch $CERTDIR/provisioning_cert.pem
touch $CERTDIR/provisioning_key.pem
touch $CERTDIR/provisioning_rootCA.pem


# Get the UUID from the EEPROM of the device - if it's not
# present, generate a clientId
echo -e -n "\e[0mChecking Edgeberry Hardware UUID... \e[0m"
if [ -f $HWIDFILE ]; then
    echo -e "\e[0;32m [Success]\e[0m"
    UUID=$(cat $HWIDFILE)
else
    echo -e "\e[0;33m[Not found]\e[0m"
    echo -e "\e[0mProceeding with a random ID... \e[0m"
    UUID=Edgeberry_$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 32)
fi

# Get the provisioning data from the Dashboard.
# This requires an official Edgeberry Hardware ID
echo -e -n "\e[0mGetting device provisioning data from $APPNAME Dashboard... \e[0m"
RESPONSE=$(curl -s -X GET -w ";%{http_code}" -d "{\"hardwareId\":\"$UUID\"}" -H 'Content-Type: application/json' https://dashboard.edgeberry.io/api/things/provisioningparameters )
# Split the response in an array based on the ';' character
IFS=';' read -r -a RESULT <<< "$RESPONSE"
PROVISIONINGDATA="${RESULT[0]}"
STATUSCODE="${RESULT[1]}"
# If the HTTP GET request was successful, use the data
# from the result
if [[ "$STATUSCODE" = "200" ]]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33m[Failed]\e[0m";
    echo -e "\e[0mProceeding with manually adding necessary data...\e[0m"
fi

PROVHOSTNAME=$(echo "$PROVISIONINGDATA" | jq -r ".endpoint")
PROVCERT=$(echo "$PROVISIONINGDATA" | jq -r ".certificate")
PROVKEY=$(echo "$PROVISIONINGDATA" | jq -r ".privateKey")

# If not hostname was fetched, provide the hostname
# manually
if [[ "$PROVHOSTNAME" = "null" ]]; then
    read -r -p "Hostname: " HOSTNAME
fi

if [[ "$PROVHOSTNAME" != "null" ]]; then
    HOSTNAME=$PROVHOSTNAME;
fi
if [[ -z "$HOSTNAME" ]]; then
    echo -e "\e[0;31mHostname cannot be empty\e[0m"
    echo -e "\e[0mExit\e[0m"
    exit 1;
fi

# Populate the provisioning certificate file
echo -e "\e[0mPopulating the provisioning certificate file... \e[0m"
if [[ "$PROVCERT" != "null" ]]; then
    echo -e "$PROVCERT" > $CERTDIR/provisioning_cert.pem
else
    nano $CERTDIR/provisioning_cert.pem
fi

# Populate the provisioning private key file
echo -e "\e[0mPopulating the provisioning private key... \e[0m"
if [[ "$PROVCERT" != "null" ]]; then
    echo -e "$PROVKEY" > $CERTDIR/provisioning_key.pem
else
    nano $CERTDIR/provisioning_key.pem
fi

# Create the settings file
echo -e -n "\e[0mCreating the settings file... \e[0m"
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
#nano $SETTINGSFILE

# Check if the last command succeeded
if [ $? -eq 0 ]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33m[Failed]\e[0m";
    echo -e "\e[0;33mExit\e[0m";
    exit 1;
fi

# Exit success
exit 0;