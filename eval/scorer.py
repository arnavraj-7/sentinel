from pydantic import BaseModel, Field
from eval.cases import EvalCase
class EvalResult(BaseModel):
    triager_score: float = Field(ge=0.0, le=1.0)
    root_cause_score: float = Field(ge=0.0, le=1.0)
    expected_category:str
    output_category:str
    expected_keywords:list[str]
    missed_keywords : list[str]
    elapsed_s:float
    

def evaluate(original_case:EvalCase,case_output:dict,elapsed_s:float)->EvalResult:
    """Evaluates a single case and returns the result"""
    
    expected=original_case.expected_category.value
    output=case_output["triager_findings"].get("failure_category","unknown") if case_output.get("triager_findings") else "unknown"
    root_cause=case_output["root_cause_findings"].get("root_cause","unknown") if case_output.get("root_cause_findings") else "unknown"
    expected_keywords = original_case.expected_root_cause_keywords
    root_cause_score=0.0
    missed_keywords = []
    for keyword in expected_keywords:
        if keyword in root_cause.lower():
            print(f"Keyword '{keyword}' found in root cause '{root_cause}'")    
            root_cause_score+=1/len(expected_keywords)
        else:
            missed_keywords.append(keyword)
    if expected==output:
        triager_score=1.0
    else:
        triager_score=0.0

    return EvalResult(triager_score=triager_score,root_cause_score=root_cause_score,expected_category=expected,output_category=output,expected_keywords=expected_keywords,missed_keywords=missed_keywords,elapsed_s=elapsed_s)