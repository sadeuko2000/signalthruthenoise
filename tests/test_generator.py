import os, random, tempfile, unittest
from generator import generate_bass, mutate, export_midi, Params, Scale


class GeneratorTests(unittest.TestCase):
    def test_deterministic(self):
        self.assertEqual(generate_bass(Params(seed=3)), generate_bass(Params(seed=3)))

    def test_first_step_anchor_and_length(self):
        t = generate_bass(Params(seed=1, length=16))
        self.assertEqual(t.pattern.length, 16)
        self.assertTrue(t.pattern.steps[0].on)

    def test_pitches_in_range(self):
        t = generate_bass(Params(seed=5, density=1.0))
        for s in t.pattern.steps:
            if s.on:
                p = t.scale.pitch(s.degree, s.octave)
                self.assertTrue(24 <= p <= 72, p)

    def test_mutation_changes_at_most_one_step(self):
        t = generate_bass(Params(seed=2))
        for seed in range(50):
            m = mutate(t, random.Random(seed))
            diff = sum(a != b for a, b in zip(t.pattern.steps, m.pattern.steps))
            self.assertLessEqual(diff, 1)

    def test_phrygian_has_flat_second(self):
        self.assertEqual(Scale(root=0, mode="phrygian").pitch(1), 1)

    def test_midi_export_valid(self):
        t = generate_bass(Params(seed=4))
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "b.mid")
            export_midi(t, path)
            with open(path, "rb") as f:
                raw = f.read()
        self.assertTrue(raw.startswith(b"MThd"))
        self.assertIn(b"MTrk", raw)
        self.assertTrue(raw.endswith(b"\xff\x2f\x00"))


if __name__ == "__main__":
    unittest.main()
