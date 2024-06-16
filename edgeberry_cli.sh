#!/bin/bash

##
#   Edgeberry CLI
#   Command line interface script that interacts with Edgeberry's stdin
#   through PM2.
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
      --start     &&Start the $APPNAME application
      --stop      &&Stop the $APPNAME application
      --restart   &&Restart the $APPNAME application
                  &&
      --identify  &&Physically identify this device with indicators
EOF
    echo ""
    ;;
  "--setup")
    bash /opt/$APPNAME/setup.sh
    ;;

  "--version"|"-v")
    jq -r .version /opt/$APPNAME/package.json
    ;;

  "--start")
    pm2 start $APPNAME
    ;;

  "--stop")
    pm2 stop $APPNAME
    ;;

  "--restart")
    pm2 restart $APPNAME
    ;;

  "--identify")
    APPID=$(pm2 id $APPNAME | sed -z 's/[^0-9]*//g')
    pm2 send $APPID $1 2>&1 > /dev/null
    # Check if command succeeded
    if [ $? -eq 0 ]; then
        exit 0;
    else
        exit -1;
    fi
    ;;

  *)
    echo "Unknown command. Run 'edgeberry help' for info."
    ;;
esac

exit 0;