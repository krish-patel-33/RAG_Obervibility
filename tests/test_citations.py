from app.services.citation_formatter import answer_has_strong_citation_support, citation_labels, extract_claims, select_citations_for_answer

CITATIONS = [{"label": f"S{i}", "score": 0.8} for i in range(1, 4)]


def test_grouped_citations_are_parsed():
    assert citation_labels("A [S1, S3] and B [S2; S1] and [S2][S3].") == ["S1", "S3", "S2", "S1", "S2", "S3"]


def test_select_citations_keeps_all_cited_labels_once():
    _, selected = select_citations_for_answer("X [S1, S3]. Y [S3].", CITATIONS)
    assert [item["label"] for item in selected] == ["S1", "S3"]


def test_markdown_answer_with_lead_in_and_bullets_is_supported():
    answer = "DDL defines structures [S1].\n\nThe statements are:\n* **CREATE** makes objects [S2].\n* **DROP** removes objects [S2, S3]."
    assert answer_has_strong_citation_support(answer, CITATIONS, min_score=0.2)


def test_uncited_claim_fails_the_gate():
    answer = "DDL defines structures [S1].\nIt was invented in the nineteen seventies by researchers."
    assert not answer_has_strong_citation_support(answer, CITATIONS, min_score=0.2)


def test_low_score_citation_fails_the_gate():
    assert not answer_has_strong_citation_support("Claim [S1].", [{"label": "S1", "score": 0.1}], min_score=0.2)


def test_headings_and_short_fragments_are_not_claims():
    assert extract_claims("## Summary\nIn short:\nOK.\nA real claim with words [S1].") == ["A real claim with words [S1]."]
