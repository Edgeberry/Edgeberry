"""
    edgeberry.py
    Core functionality for Edgeberry device.
"""

import json
from pydbus import SystemBus    # D-Bus System bus

# Edgeberry Core D-Bus 
EDGEBERRY_SERVICE = "io.edgeberry.Core"
EDGEBERRY_OBJECT = "io/edgeberry/Core"
EDGEBERRY_INTERFACE = "io.edgeberry.Core"

class Edgeberry:
    def __init__(self):
        try:
            # Connect to the D-Bus system bus
            self.bus = SystemBus()
            # Connect to the Edgeberry Core service
            self.edgeberry_core_service = self.bus.get(EDGEBERRY_SERVICE)
        except Exception as e:
            print(f"Edgeberry: error connecting to Edgeberry D-Bus: {e}")
            return None

    # Set application info
    def set_application_info(self, name, version, description):
        try:
            # Create dictionary
            application_info = {
                "name": name,
                "version": version,
                "description": description
            }

            # Convert dictionary to JSON string
            application_info_json = json.dumps(application_info)

            # Call the 'SetApplicationStatus' method on the Edgeberry Core service object
            return self.edgeberry_core_service.SetApplicationInfo(application_info_json)
        
        except Exception as e:
            # Print the error message
            print(f"Edgeberry: error setting status: {e}")
            return None

    def set_status(self, level, message):
        try:
            # Create dictionary
            status = {
                "level": level,
                "message": message
            }

            # Convert dictionary to JSON string
            status_json = json.dumps(status)

            # Call the 'SetApplicationStatus' method on the Edgeberry Core service object
            return self.edgeberry_core_service.SetApplicationStatus(status_json)
        except Exception as e:
            # Print the error message
            print(f"Edgeberry: error setting status: {e}")
            return None
    