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

##
#  Call a Core method that answers 'ok...' or 'err:<reason>', and turn that
#  into output and an exit status a packager's install script can act on.
##
dbus_application_call() {
  local method="$1"; shift
  local reply
  reply=$(dbus-send --system --print-reply=literal --dest=io.edgeberry.Core \
          /io/edgeberry/Core "io.edgeberry.Core.$method" "$@" 2>&1) || {
    echo "Could not reach the Edgeberry service. Is it running?"
    exit 1
  }
  reply=$(echo "$reply" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  case "$reply" in
    ok*)  echo "${reply#ok:}"; [ "$reply" = "ok" ] && echo "Done."; exit 0 ;;
    err:*) echo "${reply#err:}" >&2; exit 1 ;;
    *)    echo "$reply"; exit 1 ;;
  esac
}

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
      --hostname [auto] &&Show the device name, or hand it back to Edgeberry
                  &&
      --register-application <dir> &&Register the application in <dir> (reads its edgeberry.json)
      --unregister-application &&Forget the registered application and its routes
      --application &&Show the registered application
EOF
    echo ""
    ;;
  "--setup")
    bash /opt/$APPNAME/Core/scripts/setup.sh
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
    dbus-send --system --print-reply --dest=io.edgeberry.Core  /io/edgeberry/Core io.edgeberry.Core.Identify 1> /dev/null
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

  ##
  #  Device name
  #
  #  Edgeberry names the device 'EDGB-<board>', or '<prefix>-<board>' when the
  #  registered application declares one — and stops the moment somebody renames
  #  it by hand. 'auto' is the way back from that, and the only one.
  ##
  "--hostname")
    case "$2" in
      "auto")
        dbus_application_call ClaimHostname
        ;;
      "")
        hostname
        # Ownership lives in the Core's settings file. Reading it here is fine;
        # writing it is not, for the reason given under --register-application.
        if jq -e '.hostname.released' /opt/$APPNAME/Core/settings.json > /dev/null 2>&1; then
          echo "Set by hand — Edgeberry does not change it."
          echo "Run 'edgeberry --hostname auto' to hand it back."
        fi
        ;;
      *)
        echo "Usage: edgeberry --hostname [auto]"
        exit 1
        ;;
    esac
    ;;

  ##
  #  Application registration
  #
  #  These go through the Core over D-Bus rather than editing settings.json
  #  here. The Core writes that file from memory in one piece, so an edit made
  #  behind its back is erased by its next save — and only later, which is the
  #  worst way to lose a registration. The Core is the only writer.
  ##
  "--register-application")
    if [ -z "$2" ]; then
      echo "Usage: edgeberry --register-application <application directory>"
      echo "The directory must contain an edgeberry.json manifest."
      exit 1
    fi
    # Relative paths are resolved here: the Core has a different working
    # directory and would resolve them somewhere the caller did not mean.
    APPLICATION_DIR=$(cd "$2" 2>/dev/null && pwd)
    if [ -z "$APPLICATION_DIR" ]; then
      echo "No such directory: $2"
      exit 1
    fi
    dbus_application_call RegisterApplication "string:$APPLICATION_DIR"
    ;;

  "--unregister-application")
    dbus_application_call UnregisterApplication
    ;;

  "--application")
    RESULT=$(dbus-send --system --print-reply=literal --dest=io.edgeberry.Core \
             /io/edgeberry/Core io.edgeberry.Core.GetApplication 2>&1) || {
      echo "Could not reach the Edgeberry service. Is it running?"
      exit 1
    }
    RESULT=$(echo "$RESULT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [ -z "$RESULT" ] || [ "$RESULT" = "null" ]; then
      echo "No application is registered."
      exit 1
    fi
    echo "$RESULT" | jq . 2>/dev/null || echo "$RESULT"
    ;;

  *)
    echo "Unknown command. Run 'edgeberry help' for info."
    ;;
esac

exit 0;