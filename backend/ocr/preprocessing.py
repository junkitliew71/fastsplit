"""Adaptive, geometry-preserving receipt preparation."""
import cv2
import numpy as np

def prepare(image:np.ndarray,quality:dict,enhanced:bool=False):
    operations=[]; height,width=image.shape[:2]
    if max(height,width)>3000:
        scale=3000/max(height,width); image=cv2.resize(image,(round(width*scale),round(height*scale)),interpolation=cv2.INTER_AREA); operations.append('DOWNSIZE')
    # No deskew/crop here: OCR boxes must still map exactly onto the preview.
    if 'LOW_CONTRAST' in quality['issues'] or 'DARK' in quality['issues'] or enhanced:
        lab=cv2.cvtColor(image,cv2.COLOR_BGR2LAB); limit=1.35 if not enhanced else 1.8
        lab[:,:,0]=cv2.createCLAHE(clipLimit=limit,tileGridSize=(10,10)).apply(lab[:,:,0]); image=cv2.cvtColor(lab,cv2.COLOR_LAB2BGR); operations.append('GENTLE_CLAHE')
    if 'STRONG_SHADOW' in quality['issues'] and enhanced:
        gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY); background=cv2.GaussianBlur(gray,(0,0),35)
        image=cv2.cvtColor(cv2.divide(gray,background,scale=235),cv2.COLOR_GRAY2BGR); operations.append('SHADOW_NORMALIZATION')
    if enhanced and 'BLUR' in quality['issues']:
        smooth=cv2.GaussianBlur(image,(0,0),1.0); image=cv2.addWeighted(image,1.35,smooth,-.35,0); operations.append('MILD_UNSHARP_MASK')
    return image,operations
