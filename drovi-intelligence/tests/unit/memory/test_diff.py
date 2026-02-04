from src.memory.service import MemoryService


def test_diff_time_slices_added_removed_updated():
    before = [
        {
            "id": "uio-1",
            "type": "commitment",
            "status": "active",
            "title": "Ship MVP",
            "description": "",
        },
        {
            "id": "uio-2",
            "type": "task",
            "status": "active",
            "title": "Draft proposal",
            "description": "",
        },
    ]
    after = [
        {
            "id": "uio-2",
            "type": "task",
            "status": "completed",
            "title": "Draft proposal",
            "description": "",
        },
        {
            "id": "uio-3",
            "type": "risk",
            "status": "active",
            "title": "Vendor delay",
            "description": "",
        },
    ]

    diff = MemoryService._diff_time_slices(before, after)

    assert diff["summary"]["added"] == 1
    assert diff["summary"]["removed"] == 1
    assert diff["summary"]["updated"] == 1

    updated = diff["updated"][0]
    assert updated["id"] == "uio-2"
    assert "status" in updated["changes"]
    assert updated["changes"]["status"]["before"] == "active"
    assert updated["changes"]["status"]["after"] == "completed"
