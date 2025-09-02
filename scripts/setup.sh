#!/bin/bash

##
#   setup.sh
#   Setup the variables required for using the
#   Edgeberry device software.
#
#   by Sanne 'SpuQ' Santens
##

APPNAME=Edgeberry
APPCOMP=Core
CERTDIR=/opt/$APPNAME/$APPCOMP/certificates
SETTINGSFILE=/opt/$APPNAME/$APPCOMP/settings.json
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

# Get the Device Hub host from user input
echo -e "\e[0mDevice Hub Setup\e[0m"
echo -e "\e[0mPlease provide the Device Hub host (IP address or domain name)\e[0m"
read -r -p "Device Hub Host: " HOSTNAME

# Validate hostname is not empty
if [[ -z "$HOSTNAME" ]]; then
    echo -e "\e[0;31mHostname cannot be empty\e[0m"
    echo -e "\e[0mExit\e[0m"
    exit 1;
fi

# Get the provisioning certificates from the Device Hub
echo -e -n "\e[0mFetching provisioning certificates from Device Hub at $HOSTNAME... \e[0m"

# Fetch provisioning certificate
PROVCERT_RESPONSE=$(curl -s -w ";%{http_code}" "http://$HOSTNAME:3000/api/provisioning/certs/provisioning.crt")
IFS=';' read -r -a PROVCERT_RESULT <<< "$PROVCERT_RESPONSE"
PROVCERT="${PROVCERT_RESULT[0]}"
PROVCERT_STATUS="${PROVCERT_RESULT[1]}"

# Fetch provisioning private key (assuming it's available at a similar endpoint)
PROVKEY_RESPONSE=$(curl -s -w ";%{http_code}" "http://$HOSTNAME:3000/api/provisioning/certs/provisioning.key")
IFS=';' read -r -a PROVKEY_RESULT <<< "$PROVKEY_RESPONSE"
PROVKEY="${PROVKEY_RESULT[0]}"
PROVKEY_STATUS="${PROVKEY_RESULT[1]}"

# Fetch root CA certificate
ROOTCA_RESPONSE=$(curl -s -w ";%{http_code}" "http://$HOSTNAME:3000/api/provisioning/certs/ca.crt")
IFS=';' read -r -a ROOTCA_RESULT <<< "$ROOTCA_RESPONSE"
ROOTCA="${ROOTCA_RESULT[0]}"
ROOTCA_STATUS="${ROOTCA_RESULT[1]}"

# Check if all certificates were fetched successfully
if [[ "$PROVCERT_STATUS" = "200" && "$PROVKEY_STATUS" = "200" && "$ROOTCA_STATUS" = "200" ]]; then
    echo -e "\e[0;32m[Success]\e[0m"
else
    echo -e "\e[0;33m[Failed]\e[0m";
    echo -e "\e[0mOne or more certificates could not be fetched from Device Hub.\e[0m"
    echo -e "\e[0mProvisioning cert status: $PROVCERT_STATUS\e[0m"
    echo -e "\e[0mProvisioning key status: $PROVKEY_STATUS\e[0m"
    echo -e "\e[0mRoot CA status: $ROOTCA_STATUS\e[0m"
    echo -e "\e[0mProceeding with manual certificate entry...\e[0m"
    PROVCERT="null"
    PROVKEY="null"
    ROOTCA="null"
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
if [[ "$PROVKEY" != "null" ]]; then
    echo -e "$PROVKEY" > $CERTDIR/provisioning_key.pem
else
    nano $CERTDIR/provisioning_key.pem
fi

# Populate the root CA certificate file
echo -e "\e[0mPopulating the root CA certificate... \e[0m"
if [[ "$ROOTCA" != "null" ]]; then
    echo -e "$ROOTCA" > $CERTDIR/provisioning_rootCA.pem
else
    nano $CERTDIR/provisioning_rootCA.pem
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