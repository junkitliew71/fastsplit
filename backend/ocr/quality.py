import cv2
import numpy as np

def analyse(image: np.ndarray) -> dict:
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY); height,width=gray.shape
    blur=float(cv2.Laplacian(gray,cv2.CV_64F).var()); brightness=float(gray.mean())
    dark=float(np.mean(gray<35)); blown=float(np.mean(gray>245)); contrast=float(gray.std())
    illumination=cv2.GaussianBlur(gray,(0,0),max(15,min(width,height)/30))
    shadow=float(np.percentile(illumination,90)-np.percentile(illumination,10))
    issues=[]; fatal=None
    if min(width,height)<400: fatal=('LOW_IMAGE_QUALITY','Receipt image resolution is too low. Please retake the photo closer.')
    elif blur<18: fatal=('LOW_IMAGE_QUALITY','Receipt image is too blurry. Please retake the photo.')
    elif brightness<35 or dark>.72: fatal=('LOW_IMAGE_QUALITY','Receipt image is too dark. Please retake it in better light.')
    elif brightness>245 and blown>.82: fatal=('LOW_IMAGE_QUALITY','Receipt image is overexposed. Please retake it without glare.')
    if blur<70: issues.append('BLUR')
    if contrast<38: issues.append('LOW_CONTRAST')
    if shadow>85: issues.append('STRONG_SHADOW')
    if dark>.25: issues.append('DARK')
    if blown>.35: issues.append('OVEREXPOSED_AREAS')
    score=max(0.0,min(1.0,.35+min(blur,180)/360+min(contrast,70)/210-abs(brightness-170)/500-dark*.3-blown*.15))
    return {'width':width,'height':height,'blurScore':round(blur,2),'brightness':round(brightness,2),
            'contrast':round(contrast,2),'darkFraction':round(dark,4),'overexposedFraction':round(blown,4),
            'shadowScore':round(shadow,2),'qualityScore':round(score,4),'issues':issues,'fatal':fatal}
