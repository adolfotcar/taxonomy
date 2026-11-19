import taxonomy_pipeline


def test_package_imports():
    assert callable(taxonomy_pipeline.main)
