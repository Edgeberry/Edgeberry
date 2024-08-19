#!/bin/bash

##
#   Edgeberry CLI
#   Command line interface script for interacting with the Edgeberry application
#
#   symlink this script in '/bin' or '/usr/local/bin' (ln -s ./edgeberry_cli.sh /usr/local/bin/edgeberry) 
#   
#   Copyright 2024 Sanne 'SpuQ' Santens.
#
#   This program is free software: you can redistribute it and/or modify
#   it under the terms of the GNU General Public License as published by
#   the Free Software Foundation, either version 3 of the License, or
#   (at your option) any later version.
#
#   This program is distributed in the hope that it will be useful,
#   but WITHOUT ANY WARRANTY; without even the implied warranty of
#   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
#   GNU General Public License for more details.
#
#   You should have received a copy of the GNU General Public License
#   along with this program. If not, see <https://www.gnu.org/licenses/>.
##

APPNAME="Edgeberry"
SERVICENAME="io.edgeberry.core"

if [ $# -eq 0 ]
  then
    echo "No arguments were passed. Run 'edgeberry --help' for info."
    exit -1;
fi

case $1 in

  "--help")
    echo ""
    echo -e "Edgeberry CLI:"
    echo ""
    column -t -s'&&' << EOF
      --help      &&This helpful information sheet 
      --setup     &&Setup the $APPNAME variables
      --version   &&Version of the $APPNAME application
                  &&
      --enable    &&Enable the $APPNAME application (enabled by default)
      --disable   &&Disable the $APPNAME application
                  &&
      --start     &&Start the $APPNAME application
      --stop      &&Stop the $APPNAME application
      --restart   &&Restart the $APPNAME application
                  &&
      --hardware-id &&Get this device's hardware UUID
      --hardware-version &&Get the device's base board version
      --identify  &&Physically identify this device with indicators
EOF
    echo ""
    ;;
  "--setup")
    bash /opt/$APPNAME/Core/setup.sh
    ;;

  "--version"|"-v")
    jq -r .version /opt/$APPNAME/Core/package.json
    ;;

  "--start")
    systemctl restart $SERVICENAME
    ;;

  "--stop")
    systemctl stop $SERVICENAME
    ;;

  "--restart")
    systemctl restart $SERVICENAME
    ;;
  
  "--disable")
    systemctl stop $SERVICENAME
    systemctl disable $SERVICENAME
    ;;

  "--enable")
    systemctl restart $SERVICENAME
    systemctl enable $SERVICENAME
    ;;

  "--identify")
    dbus-send --system --print-reply --dest=io.edgeberry.Core  /io/edgeberry/Object io.edgeberry.Interface.Identify 1> /dev/null
    # Check if command succeeded
    if [ $? -eq 0 ]; then
        exit 0;
    else
        exit -1;
    fi
    ;;

  "--hardware-id")
    if [ -f /proc/device-tree/hat/uuid ]; then
      cat /proc/device-tree/hat/uuid
      echo ""
    else
      echo "null"
    fi
    ;;

    "--hardware-version")
    if [ -f /proc/device-tree/hat/product_ver ]; then
      hex_version=$(tr -d '\0' </proc/device-tree/hat/product_ver);
      echo "$((16#${hex_version:2:2})).$((16#${hex_version:4:2}))";
      exit 0;
    else
      echo "null"
      exit -1;
    fi
    ;;

  *)
    echo "Unknown command. Run 'edgeberry help' for info."
    ;;
esac

exit 0;