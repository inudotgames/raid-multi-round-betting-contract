import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { MultiRoundBettingERC20, MockERC20 } from "../typechain-types";

describe("MultiRoundBettingERC20", function () {
  async function deployFixture() {
    const [owner, userA, userB, userC] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20", owner);
    const token = await MockERC20Factory.deploy("TestToken", "TT", ethers.parseEther("100000")) as MockERC20;
    await token.waitForDeployment();

    const MultiRoundBettingFactory = await ethers.getContractFactory("MultiRoundBettingERC20", owner);
    const betting = await MultiRoundBettingFactory.deploy(await token.getAddress(), 500) as MultiRoundBettingERC20;
    await betting.waitForDeployment();

    // Distribute tokens
    await token.transfer(await userA.getAddress(), ethers.parseEther("1000"));
    await token.transfer(await userB.getAddress(), ethers.parseEther("1000"));
    await token.transfer(await userC.getAddress(), ethers.parseEther("1000"));

    // Approvals
    await token.connect(userA).approve(await betting.getAddress(), ethers.parseEther("1000"));
    await token.connect(userB).approve(await betting.getAddress(), ethers.parseEther("1000"));
    await token.connect(userC).approve(await betting.getAddress(), ethers.parseEther("1000"));

    return { owner, userA, userB, userC, token, betting };
  }

  it("Should allow deposits and close betting", async () => {
    const { userA, userB, betting } = await loadFixture(deployFixture);

    await betting.connect(userA).deposit(ethers.parseEther("100"), true);
    await betting.connect(userB).deposit(ethers.parseEther("200"), false);

    const round = await betting.rounds(1);
    expect(round.bettingOpen).to.equal(true);

    await betting.closeBetting();
    const roundClosed = await betting.rounds(1);
    expect(roundClosed.bettingOpen).to.equal(false);
  });

  it("Should prevent zero deposits", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await expect(betting.connect(userA).deposit(0n, true)).to.be.revertedWith("Cannot deposit zero");
  });

  it("Should prevent team switching mid-round", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(ethers.parseEther("100"), true);
    await expect(
      betting.connect(userA).deposit(ethers.parseEther("50"), false)
    ).to.be.revertedWith("Can't switch teams mid-round");
  });

  it("No losers scenario", async () => {
    const { userA, userB, token, betting } = await loadFixture(deployFixture);
    // All on A
    await betting.connect(userA).deposit(ethers.parseEther("200"), true);
    await betting.connect(userB).deposit(ethers.parseEther("100"), true);

    await betting.closeBetting();
    await betting.settleBet(true);

    const balBeforeA = await token.balanceOf(await userA.getAddress());
    const balBeforeB = await token.balanceOf(await userB.getAddress());

    await betting.connect(userA).claimAllWinnings();
    await betting.connect(userB).claimAllWinnings();

    const balAfterA = await token.balanceOf(await userA.getAddress());
    const balAfterB = await token.balanceOf(await userB.getAddress());

    expect(balAfterA - balBeforeA).to.be.greaterThan(0n);
    expect(balAfterB - balBeforeB).to.be.greaterThan(0n);
  });

  it("No winners scenario", async () => {
    const { userA, userB, token, betting } = await loadFixture(deployFixture);
    // All on A, B wins means no winners
    await betting.connect(userA).deposit(ethers.parseEther("150"), true);
    await betting.connect(userB).deposit(ethers.parseEther("150"), true);

    await betting.closeBetting();
    await betting.settleBet(false);

    const balBeforeA = await token.balanceOf(await userA.getAddress());
    const balBeforeB = await token.balanceOf(await userB.getAddress());

    await betting.connect(userA).claimAllWinnings();
    await betting.connect(userB).claimAllWinnings();

    const balAfterA = await token.balanceOf(await userA.getAddress());
    const balAfterB = await token.balanceOf(await userB.getAddress());

    expect(balAfterA - balBeforeA).to.be.greaterThan(0n);
    expect(balAfterB - balBeforeB).to.be.greaterThan(0n);
  });

  it("Should prevent settling twice", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(ethers.parseEther("100"), true);
    await betting.closeBetting();
    await betting.settleBet(true);
    await expect(betting.settleBet(true)).to.be.revertedWith("Already settled");
  });

  it("Should allow multiple rounds and ensure correct payouts for winners", async () => {
    const { userA, userB, token, betting } = await loadFixture(deployFixture);
    // Round 1
    await betting.connect(userA).deposit(ethers.parseEther("50"), true);
    await betting.connect(userB).deposit(ethers.parseEther("50"), false);
    await betting.closeBetting();
    await betting.settleBet(true); // Team A wins Round 1

    // Verify round 1 state
    const round1 = await betting.rounds(1);
    expect(round1.bettingOpen).to.equal(false);
    expect(round1.settled).to.equal(true);
    expect(round1.winnerA).to.equal(true);

    await betting.startNewRound();

    // Round 2: we want userB to win this time, so both userA and userB should bet on the winning team (Team B)
    await betting.connect(userA).deposit(ethers.parseEther("100"), false); // userA bets on Team B
    await betting.connect(userB).deposit(ethers.parseEther("200"), false); // userB also bets on Team B
    await betting.closeBetting();
    await betting.settleBet(false); // Team B wins Round 2

    // Verify round 2 state
    const round2 = await betting.rounds(2);
    expect(round2.bettingOpen).to.equal(false);
    expect(round2.settled).to.equal(true);
    expect(round2.winnerA).to.equal(false);

    const balBeforeA = await token.balanceOf(await userA.getAddress());
    const balBeforeB = await token.balanceOf(await userB.getAddress());

    // User A won Round 1, lost no rounds (Round 2 also won by B, their team), so A should gain from both rounds.
    // User B lost Round 1 but won Round 2.

    await betting.connect(userA).claimAllWinnings();
    await betting.connect(userB).claimAllWinnings();

    const balAfterA = await token.balanceOf(await userA.getAddress());
    const balAfterB = await token.balanceOf(await userB.getAddress());

    expect(balAfterA - balBeforeA).to.be.greaterThan(0n, "User A should have gained after two winning rounds");
    expect(balAfterB - balBeforeB).to.be.greaterThan(0n, "User B should have gained after winning round 2");
  });

  it("Claiming twice yields nothing second time", async () => {
    const { userA, userB, token, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(ethers.parseEther("100"), true);
    await betting.connect(userB).deposit(ethers.parseEther("100"), false);
    await betting.closeBetting();
    await betting.settleBet(true); // A wins

    await betting.connect(userA).claimAllWinnings();
    await expect(betting.connect(userA).claimAllWinnings()).to.be.revertedWith("Nothing");
  });

  it("Cannot claim before settlement", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(ethers.parseEther("100"), true);
    await expect(betting.connect(userA).claimAllWinnings()).to.be.revertedWith("Nothing");
  });

  it("Check fee collection", async () => {
    const { userA, token, owner, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(ethers.parseEther("100"), true);
    await betting.closeBetting();
    await betting.settleBet(true);
    await betting.connect(userA).claimAllWinnings();

    const balBeforeOwner = await token.balanceOf(await owner.getAddress());
    await betting.withdrawAllFees();
    const balAfterOwner = await token.balanceOf(await owner.getAddress());
    expect(balAfterOwner - balBeforeOwner).to.be.greaterThan(0n);
  });

  it("Owner cannot withdraw fees before settlement", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(ethers.parseEther("100"), true);
    await expect(betting.withdrawAllFees()).to.be.revertedWith("No fees");
  });

  it("Large deposits test", async () => {
    const { userA, userB, token, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(ethers.parseEther("500"), true);
    await betting.connect(userB).deposit(ethers.parseEther("300"), false);
    await betting.closeBetting();
    await betting.settleBet(true); // A wins

    const balBeforeA = await token.balanceOf(await userA.getAddress());
    await betting.connect(userA).claimAllWinnings();
    const balAfterA = await token.balanceOf(await userA.getAddress());
    expect(balAfterA - balBeforeA).to.be.greaterThan(0n);
  });
});
