//go:build windows

package main

import (
	"os/exec"
	"strconv"
	"time"
)

func configureDevProcess(cmd *exec.Cmd) {
	if shell, err := exec.LookPath("cmd.exe"); err == nil {
		script := cmd.Args[len(cmd.Args)-1]
		cmd.Path = shell
		cmd.Args = []string{shell, "/d", "/s", "/c", "npm", "run", script}
	}
	cmd.Cancel = func() error { return exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run() }
	cmd.WaitDelay = time.Second
}
