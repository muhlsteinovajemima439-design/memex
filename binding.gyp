{
  "targets": [
    {
      "target_name": "peercred",
      "sources": ["src/daemon/peercred.c"],
      "conditions": [
        ["OS=='linux'", {
          "defines": ["_GNU_SOURCE"]
        }]
      ]
    }
  ]
}
