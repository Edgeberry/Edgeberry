#!/bin/bash

#
#   Update application
#

URL=
TOKEN=
TMPDIR=/tmp/Edge_Gateway
APPNAME=Edge_Gateway

# Download the repository tarball
echo "Downloading repository tarball"
mkdir -p ${TMPDIR}
wget --header="Authorization: token ${TOKEN}" -O ${TMPDIR}/${APPNAME}.tar.gz ${URL}

# Check if download was successfull
if [ $? -ne 0 ]; then
    echo "Download failed, exit."
    exit 1;
fi

# Unpack the tarball
echo "Unpacking tarball"
tar -zxf ${TMPDIR}/${APPNAME}.tar.gz --directory /opt/${APPNAME} --strip-components 1
if [$? -ne 0 ]; then
    echo "Untar failed, exit."
    exit 1;
fi

# Install dependencies & build
echo "Installing depencencies"
cd /opt/${APPNAME}
npm install --save-dev
npm run build

# Clean up
echo "Cleaning up"
rm -rf ${TMPDIR}

# Restart application
pm2 restart $APPNAME

# Exit success
exit 0;
