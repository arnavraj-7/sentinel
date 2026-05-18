from eval.cases import EVAL_CASES
from eval.scorer import EvalResult
from eval.runner import run_eval_cases
import asyncio
import json
from pathlib import Path


if __name__ == "__main__":
    CaseReport =[]

    async def main():
        total_triager_score=0
        total_root_cause_score=0
        
        for case in EVAL_CASES:
            per_line_string = ""
            try:
                score : EvalResult =  await run_eval_cases(case)
                total_triager_score+=score.triager_score
                total_root_cause_score+=score.root_cause_score
                CaseReport.append({
                    "case":case.model_dump(mode="json"),
                    "result":score.model_dump(mode="json"),
                    "error":""
                })
                per_line_string+=f"{case.name}-> TS={score.triager_score} , RCS={score.root_cause_score}"
            except Exception as e:
                CaseReport.append({
                    "case":case.model_dump(mode="json"),
                    "result":None,
                    "error":str(e)
                })
                print(f"Error occurred while running case {case.name}: {e}")
                per_line_string+=f"{case.name}-> TS=0.00 , RCS=0.00 , Error:{str(e)}"
            finally:
                print(per_line_string)
                
        mean_triager_score=total_triager_score/len(EVAL_CASES)
        mean_root_cause_score=total_root_cause_score/len(EVAL_CASES)
        print(f"Mean Triager Score :{mean_triager_score} \n Mean Root Cause Score :{mean_root_cause_score} ")
        return CaseReport


report = asyncio.run(main())                       # capture the return
Path("eval_report.json").write_text(json.dumps(report, indent=2))