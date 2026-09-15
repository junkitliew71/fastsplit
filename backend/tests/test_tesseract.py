import subprocess
import unittest
from unittest.mock import patch
import numpy as np
from ocr import paddle_ocr


class TesseractTests(unittest.TestCase):
    @patch.object(paddle_ocr, 'OCR_ENGINE', 'tesseract')
    @patch.object(paddle_ocr.subprocess, 'run')
    def test_preserves_word_geometry(self, run):
        tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
        tsv+='5\t1\t1\t1\t1\t1\t10\t40\t100\t20\t95\tChicken\n'
        tsv+='5\t1\t1\t1\t1\t2\t400\t40\t60\t20\t92\t12.00\n'
        run.return_value=subprocess.CompletedProcess([],0,tsv.encode(),b'')
        blocks=paddle_ocr.recognize(np.zeros((100,500,3),dtype=np.uint8))
        self.assertEqual([b['text'] for b in blocks],['Chicken','12.00'])
        self.assertEqual(blocks[1]['x'],400)
        self.assertEqual(blocks[0]['width'],100)

    @patch.object(paddle_ocr, 'OCR_ENGINE', 'tesseract')
    @patch.object(paddle_ocr.subprocess, 'run')
    def test_failed_process_is_not_empty_success(self, run):
        run.return_value=subprocess.CompletedProcess([],1,b'',b'missing language data')
        with self.assertRaises(RuntimeError):
            paddle_ocr.recognize(np.zeros((100,500,3),dtype=np.uint8))
