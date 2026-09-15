import subprocess
import unittest
from unittest.mock import patch
import cv2
import numpy as np
from fastapi.testclient import TestClient
import main


class ScanApiTests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(main.app)
        ok,data=cv2.imencode('.png',np.zeros((800,600,3),dtype=np.uint8))
        self.image=data.tobytes()

    def upload(self,data=None):
        return self.client.post('/api/receipt/scan',files={'image':('test.png',data or self.image,'image/png')})

    def test_health(self):
        self.assertEqual(self.client.get('/health').status_code,200)

    def test_decode_failure(self):
        response=self.upload(b'not an image')
        self.assertEqual(response.status_code,400)
        self.assertEqual(response.json()['error']['code'],'IMAGE_DECODE_FAILED')

    @patch.object(main,'analyse',return_value={'fatal':None,'issues':[],'qualityScore':1})
    @patch.object(main,'prepare',side_effect=lambda image,*args:(image,[]))
    @patch.object(main,'recognize',return_value=[])
    def test_no_text_is_not_200(self,*mocks):
        response=self.upload()
        self.assertEqual(response.status_code,422)
        self.assertEqual(response.json()['error']['code'],'NO_TEXT_DETECTED')

    @patch.object(main,'analyse',return_value={'fatal':None,'issues':[],'qualityScore':1})
    @patch.object(main,'prepare',side_effect=lambda image,*args:(image,[]))
    @patch.object(main,'recognize',side_effect=subprocess.TimeoutExpired('tesseract',90))
    def test_timeout_is_explicit(self,*mocks):
        response=self.upload()
        self.assertEqual(response.status_code,504)
        self.assertEqual(response.json()['error']['code'],'OCR_TIMEOUT')
