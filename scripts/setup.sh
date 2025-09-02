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

# Function to try fetching from different ports
fetch_cert() {
    local endpoint=$1
    local ports=("8080" "80" "3000")
    
    for port in "${ports[@]}"; do
        # Use separate calls to get status and content to handle multi-line certificates
        status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://$HOSTNAME:$port/api/provisioning/certs/$endpoint" 2>/dev/null)
        if [[ "$status" = "200" ]]; then
            content=$(curl -s --connect-timeout 5 "http://$HOSTNAME:$port/api/provisioning/certs/$endpoint" 2>/dev/null)
            # Use base64 encoding to safely pass multi-line content
            encoded_content=$(echo "$content" | base64 -w 0)
            echo "$encoded_content;$status;$port"
            return 0
        fi
    done
    echo "null;404;none"
    return 1
}

# Fetch provisioning certificate
PROVCERT_RESULT=$(fetch_cert "provisioning.crt")
IFS=';' read -r PROVCERT_ENCODED PROVCERT_STATUS PROVCERT_PORT <<< "$PROVCERT_RESULT"
if [[ "$PROVCERT_ENCODED" != "null" ]]; then
    PROVCERT=$(echo "$PROVCERT_ENCODED" | base64 -d)
else
    PROVCERT="null"
fi

# Fetch provisioning private key
PROVKEY_RESULT=$(fetch_cert "provisioning.key")
IFS=';' read -r PROVKEY_ENCODED PROVKEY_STATUS PROVKEY_PORT <<< "$PROVKEY_RESULT"
if [[ "$PROVKEY_ENCODED" != "null" ]]; then
    PROVKEY=$(echo "$PROVKEY_ENCODED" | base64 -d)
else
    PROVKEY="null"
fi

# Fetch root CA certificate
ROOTCA_RESULT=$(fetch_cert "ca.crt")
IFS=';' read -r ROOTCA_ENCODED ROOTCA_STATUS ROOTCA_PORT <<< "$ROOTCA_RESULT"
if [[ "$ROOTCA_ENCODED" != "null" ]]; then
    ROOTCA=$(echo "$ROOTCA_ENCODED" | base64 -d)
else
    ROOTCA="null"
fi

# Check if all certificates were fetched successfully
if [[ "$PROVCERT_STATUS" = "200" && "$PROVKEY_STATUS" = "200" && "$ROOTCA_STATUS" = "200" ]]; then
    echo -e "\e[0;32m[Success]\e[0m"
    echo -e "\e[0mUsing Device Hub on port $PROVCERT_PORT\e[0m"
else
    echo -e "\e[0;33m[Failed]\e[0m";
    echo -e "\e[0mOne or more certificates could not be fetched from Device Hub.\e[0m"
    echo -e "\e[0mProvisioning cert: $PROVCERT_STATUS (port: $PROVCERT_PORT)\e[0m"
    echo -e "\e[0mProvisioning key: $PROVKEY_STATUS (port: $PROVKEY_PORT)\e[0m"
    echo -e "\e[0mRoot CA: $ROOTCA_STATUS (port: $ROOTCA_PORT)\e[0m"
    echo -e "\e[0mTried ports: 8080, 80, 3000\e[0m"
    echo -e "\e[0mMake sure Device Hub is running and accessible at $HOSTNAME\e[0m"
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