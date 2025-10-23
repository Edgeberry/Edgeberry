"""
    edgeberry-cloud-connect.py
    Cloud connection functionality for Edgeberry device application.
"""

import json
from pydbus import SystemBus    # D-Bus System bus

# Edgeberry Core D-Bus 
EDGEBERRY_SERVICE = "io.edgeberry.CloudConnect"
EDGEBERRY_OBJECT = "io/edgeberry/CloudConnect"
EDGEBERRY_INTERFACE = "io.edgeberry.CloudConnect"

class EdgeberryCloudConnect:
    def __init__(self):
        try:
            # Connect to the D-Bus system bus
            self.bus = SystemBus()
            # Connect to the Edgeberry Core service
            self.edgeberry_cloudconnect_service = self.bus.get(EDGEBERRY_SERVICE)
        except Exception as e:
            print(f"CloudConnect: error connecting to Edgeberry Cloud Connect D-Bus API: {e}")
            return None
        
    def send_message(self, message):
        try:
            # Create dictionary
            messaged = {
                "message": message
            }

            # Convert dictionary to JSON string
            messaged_json = json.dumps(messaged)

            # Call the 'SetApplicationStatus' method on the Edgeberry Core service object
            return self.edgeberry_cloudconnect_service.SendMessage(messaged_json)
        except Exception as e:
            # Print the error message
            print(f"CloudConnect: error sending message: {e}")
            return None